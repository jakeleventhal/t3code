Pod::Spec.new do |s|
  s.name           = 'T3VoiceAudio'
  s.version        = '1.0.0'
  s.summary        = 'Echo-cancelled PCM voice audio for T3 Code mobile.'
  s.description    = 'Streams microphone PCM out and plays PCM replies through iOS voice processing.'
  s.author         = 'T3 Tools'
  s.homepage       = 'https://t3tools.com'
  s.platforms      = {
    :ios => '18.0',
  }
  s.source         = { :path => '.' }
  s.static_framework = true
  s.swift_version  = '5.9'

  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }
  s.source_files = '**/*.swift'
end
