// Ringtone playback is handled natively in Go (internal/wa/ringtone.go)
// via PipeWire / PulseAudio / ALSA to avoid WebKit autoplay and timer restrictions.

export function playRingtone() {
  // Handled natively in Go
}

export function stopRingtone() {
  // Handled natively in Go
}
