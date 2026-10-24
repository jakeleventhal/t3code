import AVFoundation
import ExpoModulesCore

private final class VoiceAudioException: GenericException<String> {
  override var reason: String { param }
}

/// One call's audio at a time. Every method names its session, so a late callback, a cancelled
/// permission prompt, or a stale JS handle can never drive a newer call's microphone.
public final class T3VoiceAudioModule: Module {
  // Session bookkeeping and every engine mutation run here. AVFoundation callbacks hop onto it
  // asynchronously and nothing on it waits for the JS thread, so the JS thread may sync onto it.
  private let queue = DispatchQueue(label: "t3.voice-audio")
  private var reservedId: String?
  private var session: VoiceAudioSession?

  public func definition() -> ModuleDefinition {
    Name("T3VoiceAudio")

    Events("onAudio", "onPlaybackIdle", "onError")

    // Synchronous so a close issued right after cannot overtake it on the way to native.
    Function("begin") { (sessionId: String) in
      self.queue.sync { self.reserve(sessionId) }
    }

    AsyncFunction("start") { (sessionId: String, sampleRate: Double, promise: Promise) in
      guard (8_000...48_000).contains(sampleRate) else {
        promise.reject("ERR_VOICE_AUDIO_FORMAT", "Voice audio needs a sample rate between 8 and 48 kHz.")
        return
      }
      let reserved = self.queue.sync { self.reservedId == sessionId && self.session == nil }
      guard reserved else {
        promise.reject("ERR_VOICE_AUDIO_CANCELLED", "The voice audio was cancelled.")
        return
      }
      T3VoiceAudioModule.requestMicrophone { granted in
        self.queue.async {
          // The prompt can outlive the call that asked; its answer never opens audio late.
          guard self.reservedId == sessionId, self.session == nil else {
            promise.reject("ERR_VOICE_AUDIO_CANCELLED", "The voice audio was cancelled.")
            return
          }
          guard granted else {
            self.reservedId = nil
            promise.reject(
              "ERR_VOICE_AUDIO_PERMISSION",
              "Microphone access is off. Turn it on for T3 Code in Settings to call."
            )
            return
          }
          let session = VoiceAudioSession(
            id: sessionId,
            sampleRate: sampleRate,
            queue: self.queue,
            emit: { [weak self] name, body in self?.sendEvent(name, body) },
            fail: { [weak self] message in
              self?.queue.async { self?.failSession(sessionId, message) }
            }
          )
          do {
            try session.start()
            self.session = session
            promise.resolve()
          } catch {
            session.close()
            self.reservedId = nil
            promise.reject(
              "ERR_VOICE_AUDIO_START",
              (error as? VoiceAudioException)?.reason ?? "The microphone couldn't start."
            )
          }
        }
      }
    }

    // Synchronous so reply chunks keep their order across the bridge.
    Function("enqueue") { (sessionId: String, base64: String, itemId: String) throws in
      try self.queue.sync {
        guard self.reservedId == sessionId else { return }
        guard let session = self.session else {
          throw VoiceAudioException("The voice audio isn't ready yet.")
        }
        try session.enqueue(base64, itemId: itemId)
      }
    }

    Function("clear") { (sessionId: String) -> [String: Any]? in
      self.queue.sync { self.reservedId == sessionId ? self.session?.clear() : nil }
    }

    Function("setMuted") { (sessionId: String, muted: Bool) in
      self.queue.sync {
        guard self.reservedId == sessionId else { return }
        self.session?.setMuted(muted)
      }
    }

    Function("stop") { (sessionId: String) in
      self.queue.sync {
        guard self.reservedId == sessionId else { return }
        self.reservedId = nil
        self.session?.close()
        self.session = nil
      }
    }

    OnDestroy {
      self.queue.sync {
        self.reservedId = nil
        self.session?.close()
        self.session = nil
      }
    }
  }

  private func reserve(_ sessionId: String) {
    guard let previous = reservedId, previous != sessionId else {
      reservedId = sessionId
      return
    }
    session?.close()
    session = nil
    reservedId = sessionId
    sendEvent("onError", [
      "sessionId": previous,
      "message": "Another voice call took over the microphone.",
    ])
  }

  private func failSession(_ sessionId: String, _ message: String) {
    guard reservedId == sessionId, let session else { return }
    self.session = nil
    reservedId = nil
    session.close()
    sendEvent("onError", ["sessionId": sessionId, "message": message])
  }

  private static func requestMicrophone(_ completion: @escaping (Bool) -> Void) {
    switch AVAudioApplication.shared.recordPermission {
    case .granted:
      completion(true)
    case .denied:
      completion(false)
    default:
      AVAudioApplication.requestRecordPermission(completionHandler: completion)
    }
  }
}

/// Read from the tap thread without touching `queue`: removing a tap waits for its block, so the
/// block must never wait on whoever is removing it.
private final class CaptureGate {
  private let lock = NSLock()
  private var muted = false
  private var closed = false

  var isOpen: Bool {
    lock.lock()
    defer { lock.unlock() }
    return !muted && !closed
  }

  func setMuted(_ value: Bool) {
    lock.lock()
    muted = value
    lock.unlock()
  }

  func close() {
    lock.lock()
    closed = true
    lock.unlock()
  }
}

/// Mono PCM16 LE in and out, in memory only. Voice processing on the input node puts the whole
/// engine on the voice-processing I/O unit, so replies played here are cancelled from capture.
private final class VoiceAudioSession {
  private struct Scheduled {
    let itemId: String
    /// Kept until played back, so a route change can reschedule what the stopped player dropped.
    let buffer: AVAudioPCMBuffer
    let startFrame: AVAudioFramePosition
    let frames: AVAudioFramePosition
  }

  let id: String
  private let sampleRate: Double
  private let queue: DispatchQueue
  private let emit: (String, [String: Any?]) -> Void
  private let fail: (String) -> Void
  private let engine = AVAudioEngine()
  private let player = AVAudioPlayerNode()
  private let gate = CaptureGate()
  private let maxQueuedFrames: AVAudioFramePosition
  private var observers: [NSObjectProtocol] = []
  private var activatedAudioSession = false
  private var tapInstalled = false
  private var playerConnected = false
  private var closed = false

  // Playback state, only touched on `queue`.
  private var scheduled: [Scheduled] = []
  /// Frames scheduled since the player clock last restarted; positions are relative to it.
  private var scheduledFrames: AVAudioFramePosition = 0
  private var queuedFrames: AVAudioFramePosition = 0
  /// Completion callbacks from before a flush or clock restart carry an older generation.
  private var generation = 0
  /// Frames already played of the item whose buffers most recently finished.
  private var playedItem: (id: String, frames: AVAudioFramePosition)?

  init(
    id: String,
    sampleRate: Double,
    queue: DispatchQueue,
    emit: @escaping (String, [String: Any?]) -> Void,
    fail: @escaping (String) -> Void
  ) {
    self.id = id
    self.sampleRate = sampleRate
    self.queue = queue
    self.emit = emit
    self.fail = fail
    // Replies stream faster than real time; two minutes ahead is far beyond any real reply.
    self.maxQueuedFrames = AVAudioFramePosition(sampleRate * 120)
  }

  func start() throws {
    guard
      let playbackFormat = AVAudioFormat(
        commonFormat: .pcmFormatFloat32, sampleRate: sampleRate, channels: 1, interleaved: false)
    else {
      throw VoiceAudioException("This device can't play \(Int(sampleRate)) Hz voice audio.")
    }
    let audioSession = AVAudioSession.sharedInstance()
    do {
      try audioSession.setCategory(
        .playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, .allowBluetooth])
      try audioSession.setActive(true)
      activatedAudioSession = true
    } catch {
      throw VoiceAudioException("Another app is using audio. Close it and try again.")
    }
    do {
      try engine.inputNode.setVoiceProcessingEnabled(true)
    } catch {
      throw VoiceAudioException("This device couldn't turn on echo cancellation.")
    }
    engine.attach(player)
    engine.connect(player, to: engine.mainMixerNode, format: playbackFormat)
    playerConnected = true
    try installCaptureTap()
    observe()
    engine.prepare()
    do {
      try engine.start()
    } catch {
      throw VoiceAudioException("The microphone couldn't start.")
    }
  }

  func enqueue(_ base64: String, itemId: String) throws {
    guard !closed else { return }
    guard let data = Data(base64Encoded: base64), data.count % 2 == 0 else {
      throw VoiceAudioException("The voice reply contained invalid audio.")
    }
    let frames = data.count / 2
    guard frames > 0 else { return }
    guard queuedFrames + AVAudioFramePosition(frames) <= maxQueuedFrames else {
      throw VoiceAudioException("The voice reply is too long to play.")
    }
    guard
      let buffer = AVAudioPCMBuffer(
        pcmFormat: player.outputFormat(forBus: 0), frameCapacity: AVAudioFrameCount(frames)),
      let channel = buffer.floatChannelData?[0]
    else {
      throw VoiceAudioException("The voice reply couldn't be played.")
    }
    buffer.frameLength = AVAudioFrameCount(frames)
    data.withUnsafeBytes { raw in
      for index in 0..<frames {
        let sample = Int16(littleEndian: raw.loadUnaligned(fromByteOffset: index * 2, as: Int16.self))
        channel[index] = Float(sample) / 32_768
      }
    }
    schedule(buffer, itemId: itemId)
  }

  private func schedule(_ buffer: AVAudioPCMBuffer, itemId: String) {
    let frames = AVAudioFramePosition(buffer.frameLength)
    queuedFrames += frames
    // A route change stops the engine before its notification reaches `queue`. Buffers that
    // arrive in between wait here for the recovery to schedule them.
    guard engine.isRunning else {
      scheduled.append(Scheduled(itemId: itemId, buffer: buffer, startFrame: 0, frames: frames))
      return
    }
    if scheduled.isEmpty {
      // An idle player's clock keeps running through silence. Restarting it keeps positions
      // counting only audio that was actually heard.
      player.stop()
      generation += 1
      scheduledFrames = 0
    }
    let generation = self.generation
    scheduled.append(
      Scheduled(itemId: itemId, buffer: buffer, startFrame: scheduledFrames, frames: frames))
    scheduledFrames += frames
    player.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack) { [weak self] _ in
      guard let self else { return }
      self.queue.async { self.finishedBuffer(generation) }
    }
    if !player.isPlaying { player.play() }
  }

  /// Where the item being heard stopped, for truncating its transcript to what was played.
  func clear() -> [String: Any]? {
    guard !closed else { return nil }
    guard let head = scheduled.first else {
      flushPlayback()
      return nil
    }
    var partial: AVAudioFramePosition = 0
    if let nodeTime = player.lastRenderTime,
      let playerTime = player.playerTime(forNodeTime: nodeTime)
    {
      partial = min(max(playerTime.sampleTime - head.startFrame, 0), head.frames)
    }
    let earlier = playedItem?.id == head.itemId ? playedItem?.frames ?? 0 : 0
    flushPlayback()
    return ["itemId": head.itemId, "playedMs": Double(earlier + partial) * 1000 / sampleRate]
  }

  func setMuted(_ muted: Bool) {
    guard !closed else { return }
    gate.setMuted(muted)
    engine.inputNode.isVoiceProcessingInputMuted = muted
  }

  /// Releases the microphone before returning. Only the audio session hand-back is deferred,
  /// because deactivation can block; it stays ordered before any later session on `queue`.
  func close() {
    guard !closed else { return }
    closed = true
    gate.close()
    for observer in observers { NotificationCenter.default.removeObserver(observer) }
    observers.removeAll()
    if tapInstalled { engine.inputNode.removeTap(onBus: 0) }
    tapInstalled = false
    flushPlayback()
    engine.stop()
    if activatedAudioSession {
      queue.async {
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
      }
    }
  }

  private func installCaptureTap() throws {
    let input = engine.inputNode
    let inputFormat = input.outputFormat(forBus: 0)
    guard
      inputFormat.sampleRate > 0, inputFormat.channelCount > 0,
      let captureFormat = AVAudioFormat(
        commonFormat: .pcmFormatInt16, sampleRate: sampleRate, channels: 1, interleaved: true),
      let converter = AVAudioConverter(from: inputFormat, to: captureFormat)
    else {
      throw VoiceAudioException("No microphone is available.")
    }
    // Voice processing can report extra reference channels; the first is the processed voice.
    if inputFormat.channelCount > 1 { converter.channelMap = [0] }
    let gate = self.gate
    let id = self.id
    let emit = self.emit
    let fail = self.fail
    input.installTap(
      onBus: 0, bufferSize: AVAudioFrameCount(inputFormat.sampleRate / 20), format: inputFormat
    ) { buffer, _ in
      guard gate.isOpen else { return }
      do {
        guard let data = try VoiceAudioSession.convert(buffer, with: converter, to: captureFormat) else { return }
        emit("onAudio", ["sessionId": id, "data": data.base64EncodedString()])
      } catch {
        fail("The microphone audio couldn't be read.")
      }
    }
    tapInstalled = true
  }

  private static func convert(
    _ buffer: AVAudioPCMBuffer, with converter: AVAudioConverter, to format: AVAudioFormat
  ) throws -> Data? {
    let ratio = format.sampleRate / buffer.format.sampleRate
    let capacity = AVAudioFrameCount((Double(buffer.frameLength) * ratio).rounded(.up)) + 32
    guard let output = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity) else {
      return nil
    }
    var supplied = false
    var conversionError: NSError?
    let status = converter.convert(to: output, error: &conversionError) { _, inputStatus in
      if supplied {
        inputStatus.pointee = .noDataNow
        return nil
      }
      supplied = true
      inputStatus.pointee = .haveData
      return buffer
    }
    if status == .error {
      throw conversionError ?? VoiceAudioException("The microphone audio couldn't be converted.")
    }
    guard output.frameLength > 0, let samples = output.int16ChannelData else { return nil }
    return Data(bytes: samples[0], count: Int(output.frameLength) * MemoryLayout<Int16>.size)
  }

  private func observe() {
    let center = NotificationCenter.default
    let fail = self.fail
    observers.append(
      center.addObserver(
        forName: AVAudioSession.interruptionNotification,
        object: AVAudioSession.sharedInstance(), queue: nil
      ) { note in
        guard
          let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
          AVAudioSession.InterruptionType(rawValue: raw) == .began
        else { return }
        fail("A call or another app interrupted the voice audio.")
      })
    observers.append(
      center.addObserver(
        forName: AVAudioSession.mediaServicesWereResetNotification,
        object: AVAudioSession.sharedInstance(), queue: nil
      ) { _ in
        fail("The device's audio restarted. Start the call again.")
      })
    // Route changes, such as connecting headphones, stop the engine and may change the input
    // format. Capture and the unheard part of the reply resume on the new route.
    observers.append(
      center.addObserver(forName: .AVAudioEngineConfigurationChange, object: engine, queue: nil) {
        [weak self] _ in
        guard let self else { return }
        self.queue.async { self.recoverFromConfigurationChange() }
      })
  }

  private func recoverFromConfigurationChange() {
    guard !closed else { return }
    // The stopped engine no longer reports how far into a buffer it got, so every buffer whose
    // playback wasn't confirmed replays from its start. Positions keep counting only confirmed
    // audio, so a later barge-in never truncates the reply past what was heard.
    engine.stop()
    let unfinished = scheduled
    flushPlayback(keepingPlayed: true)
    if tapInstalled { engine.inputNode.removeTap(onBus: 0) }
    tapInstalled = false
    do {
      try installCaptureTap()
      engine.prepare()
      try engine.start()
    } catch {
      fail("The audio route changed and voice audio couldn't continue.")
      return
    }
    for entry in unfinished { schedule(entry.buffer, itemId: entry.itemId) }
  }

  private func flushPlayback(keepingPlayed: Bool = false) {
    generation += 1
    if playerConnected { player.stop() }
    scheduled.removeAll()
    scheduledFrames = 0
    queuedFrames = 0
    if !keepingPlayed { playedItem = nil }
  }

  private func finishedBuffer(_ generation: Int) {
    guard !closed, generation == self.generation, !scheduled.isEmpty else { return }
    let done = scheduled.removeFirst()
    queuedFrames -= done.frames
    if let played = playedItem, played.id == done.itemId {
      playedItem = (played.id, played.frames + done.frames)
    } else {
      playedItem = (done.itemId, done.frames)
    }
    if scheduled.isEmpty { emit("onPlaybackIdle", ["sessionId": id]) }
  }
}
