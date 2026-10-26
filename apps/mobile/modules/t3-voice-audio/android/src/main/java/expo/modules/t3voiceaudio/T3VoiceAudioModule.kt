package expo.modules.t3voiceaudio

import android.Manifest
import android.annotation.SuppressLint
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioAttributes
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioFocusRequest
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.AudioRecordingConfiguration
import android.media.AudioTrack
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.NoiseSuppressor
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Base64
import expo.modules.interfaces.permissions.PermissionsStatus
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.thread
import kotlin.concurrent.withLock

private class VoiceAudioException(message: String) : CodedException("ERR_VOICE_AUDIO", message, null)

/**
 * One call's audio at a time. Every method names its session, so a late callback, a cancelled
 * permission prompt, or a stale JS handle can never drive a newer call's microphone.
 */
class T3VoiceAudioModule : Module() {
  private val lock = Any()
  private var reservedId: String? = null
  private var session: VoiceAudioSession? = null

  // Opening audio hardware blocks; it never runs on the JS thread.
  private val setup: ExecutorService =
    Executors.newSingleThreadExecutor { runnable -> Thread(runnable, "t3-voice-audio-setup") }

  override fun definition() = ModuleDefinition {
    Name("T3VoiceAudio")

    Events("onAudio", "onPlaybackIdle", "onError")

    Function("preferSpeaker") {
      val context = appContext.reactContext ?: return@Function
      val manager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
      manager.mode = AudioManager.MODE_IN_COMMUNICATION
      val external = manager.getDevices(AudioManager.GET_DEVICES_OUTPUTS).any {
        it.type == AudioDeviceInfo.TYPE_WIRED_HEADSET || it.type == AudioDeviceInfo.TYPE_WIRED_HEADPHONES ||
          it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO || it.type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP ||
          it.type == AudioDeviceInfo.TYPE_USB_HEADSET || it.type == AudioDeviceInfo.TYPE_BLE_HEADSET
      }
      if (!external) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
          manager.availableCommunicationDevices.firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER }
            ?.let { manager.setCommunicationDevice(it) }
        } else {
          @Suppress("DEPRECATION")
          manager.isSpeakerphoneOn = true
        }
      }
    }

    Function("releaseWebRtcRoute") {
      val context = appContext.reactContext ?: return@Function
      val manager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) manager.clearCommunicationDevice()
      manager.mode = AudioManager.MODE_NORMAL
    }


    // Synchronous so a close issued right after cannot overtake it on the way to native.
    Function("begin") { sessionId: String -> reserve(sessionId) }

    AsyncFunction("start") { sessionId: String, sampleRate: Int, promise: Promise ->
      start(sessionId, sampleRate, promise)
    }

    // Synchronous so reply chunks keep their order across the bridge.
    Function("enqueue") { sessionId: String, base64: String, itemId: String ->
      enqueue(sessionId, base64, itemId)
    }

    Function("clear") { sessionId: String -> current(sessionId)?.clear() }

    Function("setMuted") { sessionId: String, muted: Boolean ->
      current(sessionId)?.setMuted(muted)
    }

    Function("stop") { sessionId: String -> stop(sessionId) }

    OnDestroy {
      val closing = synchronized(lock) {
        reservedId = null
        session.also { session = null }
      }
      closing?.close()
      setup.shutdown()
    }
  }

  private fun reserve(sessionId: String) {
    val (previous, replaced) = synchronized(lock) {
      val previous = reservedId
      if (previous == sessionId) return
      reservedId = sessionId
      previous to session.also { session = null }
    }
    replaced?.close()
    if (previous != null) {
      sendEvent(
        "onError",
        mapOf("sessionId" to previous, "message" to "Another voice call took over the microphone."),
      )
    }
  }

  private fun start(sessionId: String, sampleRate: Int, promise: Promise) {
    if (sampleRate !in 8_000..48_000) {
      promise.reject(
        "ERR_VOICE_AUDIO_FORMAT",
        "Voice audio needs a sample rate between 8 and 48 kHz.",
        null,
      )
      return
    }
    val reserved = synchronized(lock) { reservedId == sessionId && session == null }
    if (!reserved) {
      promise.reject("ERR_VOICE_AUDIO_CANCELLED", "The voice audio was cancelled.", null)
      return
    }
    val permissions = appContext.permissions
    if (permissions == null) {
      promise.reject("ERR_VOICE_AUDIO_PERMISSION", "Microphone access couldn't be requested.", null)
      return
    }
    val proceed = { granted: Boolean -> setup.execute { open(sessionId, sampleRate, granted, promise) } }
    if (permissions.hasGrantedPermissions(Manifest.permission.RECORD_AUDIO)) {
      proceed(true)
    } else {
      permissions.askForPermissions(
        { result ->
          proceed(result[Manifest.permission.RECORD_AUDIO]?.status == PermissionsStatus.GRANTED)
        },
        Manifest.permission.RECORD_AUDIO,
      )
    }
  }

  private fun open(sessionId: String, sampleRate: Int, granted: Boolean, promise: Promise) {
    synchronized(lock) {
      // The prompt can outlive the call that asked; its answer never opens audio late.
      if (reservedId != sessionId || session != null) {
        promise.reject("ERR_VOICE_AUDIO_CANCELLED", "The voice audio was cancelled.", null)
        return
      }
      if (!granted) {
        reservedId = null
        promise.reject(
          "ERR_VOICE_AUDIO_PERMISSION",
          "Microphone access is off. Turn it on for T3 Code in Settings to call.",
          null,
        )
        return
      }
      val context = appContext.reactContext
      if (context == null) {
        reservedId = null
        promise.reject("ERR_VOICE_AUDIO_START", "The microphone couldn't start.", null)
        return
      }
      val created = VoiceAudioSession(
        context = context,
        id = sessionId,
        sampleRate = sampleRate,
        emit = { name, body -> sendEvent(name, body) },
        fail = { message -> failSession(sessionId, message) },
      )
      try {
        created.start()
        session = created
        promise.resolve(null)
      } catch (error: Throwable) {
        created.close()
        reservedId = null
        promise.reject(
          "ERR_VOICE_AUDIO_START",
          (error as? VoiceAudioException)?.message ?: "The microphone couldn't start.",
          null,
        )
      }
    }
  }

  private fun current(sessionId: String): VoiceAudioSession? =
    synchronized(lock) { if (reservedId == sessionId) session else null }

  private fun enqueue(sessionId: String, base64: String, itemId: String) {
    val target = synchronized(lock) {
      if (reservedId != sessionId) return
      session ?: throw VoiceAudioException("The voice audio isn't ready yet.")
    }
    target.enqueue(base64, itemId)
  }

  private fun stop(sessionId: String) {
    val closing = synchronized(lock) {
      if (reservedId != sessionId) return
      reservedId = null
      session.also { session = null }
    }
    closing?.close()
  }

  private fun failSession(sessionId: String, message: String) {
    val failed = synchronized(lock) {
      if (reservedId != sessionId) return
      val failed = session ?: return
      session = null
      reservedId = null
      failed
    }
    failed.close()
    sendEvent("onError", mapOf("sessionId" to sessionId, "message" to message))
  }
}

private class Chunk(val itemId: String, val pcm: ByteArray, val frames: Long, val generation: Int)

/** A contiguous span of written frames belonging to one reply item. */
private class Run(val itemId: String, val start: Long, var end: Long)

/**
 * Mono PCM16 LE in and out, in memory only. Capture uses the voice-communication source and
 * playback the voice-communication usage, which is what the platform echo canceller pairs.
 */
private class VoiceAudioSession(
  private val context: Context,
  private val id: String,
  private val sampleRate: Int,
  private val emit: (String, Map<String, Any?>) -> Unit,
  private val fail: (String) -> Unit,
) {
  private val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
  private val attributes = AudioAttributes.Builder()
    .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
    .build()
  private val mainHandler = Handler(Looper.getMainLooper())
  private val focusListener = AudioManager.OnAudioFocusChangeListener { change ->
    if (change == AudioManager.AUDIOFOCUS_LOSS || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) {
      fail("A call or another app interrupted the voice audio.")
    }
  }
  // Replies stream faster than real time; two minutes ahead is far beyond any real reply.
  private val maxQueuedFrames = sampleRate.toLong() * 120

  @Volatile private var closed = false
  @Volatile private var muted = false
  private var record: AudioRecord? = null
  private var track: AudioTrack? = null
  private var echoCanceler: AcousticEchoCanceler? = null
  private var noiseSuppressor: NoiseSuppressor? = null
  // Typed loosely so API 24 devices never resolve the API 26 class.
  private var focusRequest: Any? = null
  private var focusHeld = false
  private var recordingCallback: AudioManager.AudioRecordingCallback? = null
  private var previousMode: Int? = null

  // Routing state, guarded by `routeLock`. Device and SCO callbacks arrive on the main thread.
  private val routeLock = Any()
  private var routedDevice = false
  private var previousSpeakerphone: Boolean? = null
  private var scoStarted = false
  /** Set when the headset refused or dropped SCO, until the devices change again. */
  private var scoFailed = false
  private var deviceCallback: AudioDeviceCallback? = null
  private var scoReceiver: BroadcastReceiver? = null
  private var captureThread: Thread? = null
  private var writerThread: Thread? = null

  // Playback state, guarded by `state`.
  private val state = ReentrantLock()
  private val changed = state.newCondition()
  private val chunks = ArrayDeque<Chunk>()
  private var queuedFrames = 0L
  /** Bumped by clear; chunks and in-flight writes from an older generation are discarded. */
  private var generation = 0
  private var writtenGeneration = -1
  private val runs = ArrayList<Run>()
  /** Frames written since the track was last flushed; positions are relative to that flush. */
  private var writtenFrames = 0L
  /** End of the last reply audio written; silence written after it doesn't count as heard. */
  private var audioEnd = 0L
  private var baselineHead = 0L
  private var idlePending = false
  /** When to look at the head next, where it was last seen, and whether silence was added. */
  private var drainCheckAt = 0L
  private var drainHead = 0L
  private var drainPadded = false

  @SuppressLint("MissingPermission")
  fun start() {
    requestFocus()
    previousMode = audioManager.mode
    audioManager.mode = AudioManager.MODE_IN_COMMUNICATION
    followRoutes()

    val minRecord = AudioRecord.getMinBufferSize(
      sampleRate,
      AudioFormat.CHANNEL_IN_MONO,
      AudioFormat.ENCODING_PCM_16BIT,
    )
    if (minRecord <= 0) throw VoiceAudioException("This device can't record $sampleRate Hz voice audio.")
    val record = AudioRecord(
      MediaRecorder.AudioSource.VOICE_COMMUNICATION,
      sampleRate,
      AudioFormat.CHANNEL_IN_MONO,
      AudioFormat.ENCODING_PCM_16BIT,
      maxOf(minRecord, sampleRate / 5 * 2),
    )
    this.record = record
    if (record.state != AudioRecord.STATE_INITIALIZED) {
      throw VoiceAudioException("The microphone couldn't start.")
    }
    // Most devices already cancel echo for this source; attaching the effect covers the rest.
    if (AcousticEchoCanceler.isAvailable()) {
      echoCanceler = AcousticEchoCanceler.create(record.audioSessionId)?.apply { enabled = true }
    }
    if (NoiseSuppressor.isAvailable()) {
      noiseSuppressor = NoiseSuppressor.create(record.audioSessionId)?.apply { enabled = true }
    }

    val minTrack = AudioTrack.getMinBufferSize(
      sampleRate,
      AudioFormat.CHANNEL_OUT_MONO,
      AudioFormat.ENCODING_PCM_16BIT,
    )
    if (minTrack <= 0) throw VoiceAudioException("This device can't play $sampleRate Hz voice audio.")
    val track = AudioTrack.Builder()
      .setAudioAttributes(attributes)
      .setAudioFormat(
        AudioFormat.Builder()
          .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
          .setSampleRate(sampleRate)
          .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
          .build(),
      )
      .setTransferMode(AudioTrack.MODE_STREAM)
      .setBufferSizeInBytes(minTrack * 2)
      .build()
    this.track = track
    if (track.state != AudioTrack.STATE_INITIALIZED) {
      throw VoiceAudioException("The speaker couldn't start.")
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      // A short reply must not wait in the buffer for a fill level it never reaches.
      runCatching { track.setStartThresholdInFrames(sampleRate / 50) }
    }

    watchSilencing(record)
    record.startRecording()
    if (record.recordingState != AudioRecord.RECORDSTATE_RECORDING) {
      throw VoiceAudioException("Another app is using the microphone.")
    }
    captureThread = thread(name = "t3-voice-capture") { captureLoop(record) }
    writerThread = thread(name = "t3-voice-playback") { writerLoop(track) }
  }

  fun enqueue(base64: String, itemId: String) {
    val pcm = try {
      Base64.decode(base64, Base64.DEFAULT)
    } catch (_: IllegalArgumentException) {
      throw VoiceAudioException("The voice reply contained invalid audio.")
    }
    if (pcm.size % 2 != 0) throw VoiceAudioException("The voice reply contained invalid audio.")
    if (pcm.isEmpty()) return
    val frames = pcm.size / 2L
    state.withLock {
      if (closed) return
      if (queuedFrames + frames > maxQueuedFrames) {
        throw VoiceAudioException("The voice reply is too long to play.")
      }
      chunks.addLast(Chunk(itemId, pcm, frames, generation))
      queuedFrames += frames
      changed.signalAll()
    }
  }

  /** Where the item being heard stopped, for truncating its transcript to what was played. */
  fun clear(): Map<String, Any>? {
    val track = track ?: return null
    state.withLock {
      if (closed) return null
      val head = headFrames(track)
      val itemId = runs.firstOrNull { head < it.end }?.itemId ?: chunks.firstOrNull()?.itemId
      // Silence written to push a stalled tail out can split an item into runs; only the
      // frames of its runs the head has passed were heard.
      val position = itemId?.let { item ->
        item to runs.filter { it.itemId == item }.sumOf { maxOf(0L, minOf(head, it.end) - it.start) }
      }
      generation += 1
      chunks.clear()
      queuedFrames = 0
      runs.clear()
      writtenFrames = 0
      idlePending = false
      runCatching {
        track.pause()
        track.flush()
      }
      changed.signalAll()
      return position?.let { (itemId, frames) ->
        mapOf("itemId" to itemId, "playedMs" to maxOf(0L, frames) * 1000.0 / sampleRate)
      }
    }
  }

  fun setMuted(value: Boolean) {
    muted = value
  }

  /**
   * Stops the microphone and silences playback before returning. Native buffers are released
   * on a short-lived thread once the capture and playback threads have exited.
   */
  fun close() {
    state.withLock {
      if (closed) return
      closed = true
      chunks.clear()
      changed.signalAll()
    }
    record?.let { runCatching { it.stop() } }
    track?.let {
      runCatching {
        it.pause()
        it.flush()
      }
    }
    recordingCallback?.let { runCatching { audioManager.unregisterAudioRecordingCallback(it) } }
    recordingCallback = null
    synchronized(routeLock) { restoreRoute() }
    previousMode?.let { audioManager.mode = it }
    previousMode = null
    abandonFocus()
    val capture = captureThread
    val writer = writerThread
    val record = record
    val track = track
    val echoCanceler = echoCanceler
    val noiseSuppressor = noiseSuppressor
    thread(name = "t3-voice-release") {
      capture?.join(1_000)
      writer?.join(1_000)
      echoCanceler?.release()
      noiseSuppressor?.release()
      record?.release()
      track?.release()
    }
  }

  private fun requestFocus() {
    val result = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
        .setAudioAttributes(attributes)
        .setOnAudioFocusChangeListener(focusListener, mainHandler)
        .build()
      focusRequest = request
      audioManager.requestAudioFocus(request)
    } else {
      @Suppress("DEPRECATION")
      audioManager.requestAudioFocus(
        focusListener,
        AudioManager.STREAM_VOICE_CALL,
        AudioManager.AUDIOFOCUS_GAIN_TRANSIENT,
      )
    }
    if (result != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
      throw VoiceAudioException("A call or another app is using audio. Try again when it ends.")
    }
    focusHeld = true
  }

  private fun abandonFocus() {
    if (!focusHeld) return
    focusHeld = false
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      (focusRequest as? AudioFocusRequest)?.let { audioManager.abandonAudioFocusRequest(it) }
    } else {
      @Suppress("DEPRECATION")
      audioManager.abandonAudioFocus(focusListener)
    }
  }

  /**
   * Communication mode defaults to the earpiece; a call should use a headset or the speaker.
   * The choice is made again whenever an output appears or disappears, because an explicitly
   * chosen route doesn't follow headsets on its own.
   */
  private fun followRoutes() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
      val receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
          // Registering replays the last state, which may be an earlier call's link closing.
          if (isInitialStickyBroadcast) return
          val state = intent.getIntExtra(AudioManager.EXTRA_SCO_AUDIO_STATE, -1)
          val previous = intent.getIntExtra(AudioManager.EXTRA_SCO_AUDIO_PREVIOUS_STATE, -1)
          // A refused or dropped link leaves audio on the earpiece; fall back to another route.
          if (state == AudioManager.SCO_AUDIO_STATE_DISCONNECTED && previous != state) {
            synchronized(routeLock) {
              if (closed || !scoStarted) return
              scoFailed = true
              route()
            }
          }
        }
      }
      context.registerReceiver(receiver, IntentFilter(AudioManager.ACTION_SCO_AUDIO_STATE_UPDATED))
      scoReceiver = receiver
    }
    val callback = object : AudioDeviceCallback() {
      override fun onAudioDevicesAdded(added: Array<out AudioDeviceInfo>) = rerouteForDevices()

      override fun onAudioDevicesRemoved(removed: Array<out AudioDeviceInfo>) = rerouteForDevices()
    }
    synchronized(routeLock) { route() }
    // Registration also reports the current devices once, which routes again harmlessly.
    audioManager.registerAudioDeviceCallback(callback, mainHandler)
    deviceCallback = callback
  }

  private fun rerouteForDevices() {
    synchronized(routeLock) {
      if (closed) return
      scoFailed = false
      route()
    }
  }

  /** Called with `routeLock` held. */
  private fun route() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      val devices = audioManager.availableCommunicationDevices
      val current = audioManager.communicationDevice
      for (type in PREFERRED_ROUTES) {
        val device = devices.firstOrNull { it.type == type } ?: continue
        if (current?.id == device.id || audioManager.setCommunicationDevice(device)) {
          routedDevice = true
          return
        }
      }
      return
    }
    val outputs = audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS)
    val bluetooth = !scoFailed && outputs.any { it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO }
    val wired = outputs.any { it.type in WIRED_ROUTES }
    if (previousSpeakerphone == null) {
      @Suppress("DEPRECATION")
      previousSpeakerphone = audioManager.isSpeakerphoneOn
    }
    if (bluetooth && !scoStarted) {
      // Before Android 12 a Bluetooth headset carries call audio only over an SCO link.
      scoStarted = true
      @Suppress("DEPRECATION")
      audioManager.startBluetoothSco()
      @Suppress("DEPRECATION")
      audioManager.isBluetoothScoOn = true
    } else if (!bluetooth && scoStarted) {
      stopSco()
    }
    @Suppress("DEPRECATION")
    audioManager.isSpeakerphoneOn = !bluetooth && !wired
  }

  /** Called with `routeLock` held. */
  private fun stopSco() {
    scoStarted = false
    @Suppress("DEPRECATION")
    audioManager.isBluetoothScoOn = false
    @Suppress("DEPRECATION")
    audioManager.stopBluetoothSco()
  }

  /** Called with `routeLock` held, after `closed` is set so no callback routes again. */
  private fun restoreRoute() {
    deviceCallback?.let { runCatching { audioManager.unregisterAudioDeviceCallback(it) } }
    deviceCallback = null
    scoReceiver?.let { runCatching { context.unregisterReceiver(it) } }
    scoReceiver = null
    if (routedDevice && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      runCatching { audioManager.clearCommunicationDevice() }
    }
    routedDevice = false
    if (scoStarted) runCatching { stopSco() }
    previousSpeakerphone?.let {
      @Suppress("DEPRECATION")
      audioManager.isSpeakerphoneOn = it
    }
    previousSpeakerphone = null
  }

  /** Android silences the background client when another app takes the microphone. */
  private fun watchSilencing(record: AudioRecord) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return
    val sessionId = record.audioSessionId
    val callback = object : AudioManager.AudioRecordingCallback() {
      override fun onRecordingConfigChanged(configs: MutableList<AudioRecordingConfiguration>) {
        if (configs.any { it.clientAudioSessionId == sessionId && it.isClientSilenced }) {
          fail("Another app is using the microphone.")
        }
      }
    }
    audioManager.registerAudioRecordingCallback(callback, mainHandler)
    recordingCallback = callback
  }

  private fun captureLoop(record: AudioRecord) {
    val frameBytes = sampleRate / 20 * 2
    val buffer = ByteArray(frameBytes)
    while (!closed) {
      var filled = 0
      while (filled < frameBytes) {
        val read = record.read(buffer, filled, frameBytes - filled)
        if (closed) return
        if (read < 0) {
          fail("The microphone stopped.")
          return
        }
        filled += read
      }
      if (!muted) {
        emit(
          "onAudio",
          mapOf("sessionId" to id, "data" to Base64.encodeToString(buffer, 0, filled, Base64.NO_WRAP)),
        )
      }
    }
  }

  private fun writerLoop(track: AudioTrack) {
    val sliceBytes = sampleRate / 50 * 2
    while (true) {
      var silence: Chunk? = null
      var stuck = false
      val chunk = state.withLock {
        while (!closed && chunks.isEmpty()) {
          if (!idlePending) {
            changed.await()
            continue
          }
          // Stream mode has no drain callback, so the head is checked once the written audio
          // should have played, and again only while it keeps moving.
          val wait = drainCheckAt - System.nanoTime()
          if (wait > 0) {
            changed.awaitNanos(wait)
            continue
          }
          val head = headFrames(track)
          if (head >= audioEnd) {
            idlePending = false
            break
          }
          if (head != drainHead) {
            drainHead = head
            scheduleDrainCheck(head, DRAIN_MARGIN_MS)
            continue
          }
          if (drainPadded) {
            stuck = true
            break
          }
          // A stream track holds audio below its start threshold, or a tail shorter than one
          // mixer period, until more arrives. Silence after the reply pushes it out.
          drainPadded = true
          val frames = track.bufferSizeInFrames.toLong()
          silence = Chunk("", ByteArray(frames.toInt() * 2), frames, generation)
          writtenFrames += frames
          scheduleDrainCheck(head, STUCK_MARGIN_MS)
          break
        }
        if (closed) return
        if (stuck || silence != null) null else chunks.removeFirstOrNull()?.also { beginWrite(track, it) }
      }
      if (stuck) {
        fail("The speaker stopped playing the reply.")
        return
      }
      val next = silence ?: chunk
      if (next == null) {
        emit("onPlaybackIdle", mapOf("sessionId" to id))
        continue
      }
      var offset = 0
      while (offset < next.pcm.size) {
        if (state.withLock { closed || next.generation != generation }) break
        val written = track.write(next.pcm, offset, minOf(sliceBytes, next.pcm.size - offset))
        if (written < 0) {
          if (!closed) fail("The speaker stopped.")
          return
        }
        offset += written
      }
    }
  }

  /** Called with `state` held, just before the writer thread writes `chunk`. */
  private fun beginWrite(track: AudioTrack, chunk: Chunk) {
    queuedFrames -= chunk.frames
    if (chunk.generation != writtenGeneration) {
      // A clear can let one in-flight slice land after its flush; drop it before resuming.
      track.pause()
      track.flush()
      writtenGeneration = chunk.generation
      writtenFrames = 0
      runs.clear()
      baselineHead = rawHead(track)
    }
    val last = runs.lastOrNull()
    if (last != null && last.itemId == chunk.itemId && last.end == writtenFrames) {
      last.end += chunk.frames
    } else {
      runs.add(Run(chunk.itemId, writtenFrames, writtenFrames + chunk.frames))
    }
    writtenFrames += chunk.frames
    audioEnd = writtenFrames
    val head = headFrames(track)
    while (runs.size > 1 && runs[0].end <= head && runs[0].itemId != runs[1].itemId) runs.removeAt(0)
    if (track.playState != AudioTrack.PLAYSTATE_PLAYING) track.play()
    idlePending = true
    // A track that never started is caught at the first check rather than one later.
    drainHead = head
    drainPadded = false
    scheduleDrainCheck(head, DRAIN_MARGIN_MS)
  }

  /** Called with `state` held: look again once everything written should have played. */
  private fun scheduleDrainCheck(head: Long, marginMs: Long) {
    val remainingMs = maxOf(0L, writtenFrames - head) * 1000 / sampleRate
    drainCheckAt = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(remainingMs + marginMs)
  }

  // The head counts only rendered frames, so silence between replies never shifts positions.
  private fun headFrames(track: AudioTrack): Long = rawHead(track) - baselineHead

  private fun rawHead(track: AudioTrack): Long = track.playbackHeadPosition.toLong() and 0xFFFF_FFFFL

  private companion object {
    val WIRED_ROUTES = setOf(
      AudioDeviceInfo.TYPE_WIRED_HEADSET,
      AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
      AudioDeviceInfo.TYPE_USB_HEADSET,
    )
    val PREFERRED_ROUTES = listOf(
      AudioDeviceInfo.TYPE_BLE_HEADSET,
      AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
      AudioDeviceInfo.TYPE_WIRED_HEADSET,
      AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
      AudioDeviceInfo.TYPE_USB_HEADSET,
      AudioDeviceInfo.TYPE_BUILTIN_SPEAKER,
    )
    /** Slack past the expected drain before the head is checked again. */
    const val DRAIN_MARGIN_MS = 60L
    /** Slack after padding with silence before an unmoved head means the speaker stopped. */
    const val STUCK_MARGIN_MS = 1_000L
  }
}
