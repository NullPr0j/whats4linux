package wa

import (
	"encoding/binary"
	"io"
	"log"
	"math"
	"sync"
	"sync/atomic"

	"github.com/gen2brain/malgo"
	"github.com/purpshell/meowcaller"
)

// MicSource implements meowcaller.AudioSource for microphone capture.
type MicSource struct {
	frameCh chan []float32
	muted   atomic.Bool
	closed  atomic.Bool
	mu      sync.Mutex
}

func NewMicSource() *MicSource {
	return &MicSource{
		frameCh: make(chan []float32, 20), // ~1.2s buffer
	}
}

// Push feeds recorded samples into the source.
func (m *MicSource) Push(samples []float32) {
	if m.closed.Load() {
		return
	}
	cp := make([]float32, len(samples))
	copy(cp, samples)

	select {
	case m.frameCh <- cp:
	default:
		// Drop oldest frame to maintain real-time low latency
		select {
		case <-m.frameCh:
		default:
		}
		m.frameCh <- cp
	}
}

func (m *MicSource) SetMute(muted bool) {
	m.muted.Store(muted)
}

func (m *MicSource) IsMuted() bool {
	return m.muted.Load()
}

// ReadFrame yields the next 16kHz mono float32 frame to meowcaller.
func (m *MicSource) ReadFrame() ([]float32, error) {
	if m.closed.Load() {
		return nil, io.EOF
	}

	silence := make([]float32, meowcaller.FrameSamples)

	if m.muted.Load() {
		// Drain any buffered microphone frames and emit silence
		select {
		case <-m.frameCh:
		default:
		}
		return silence, nil
	}

	select {
	case frame, ok := <-m.frameCh:
		if !ok {
			return nil, io.EOF
		}
		return frame, nil
	default:
		// Return silence if capture is temporarily starved
		return silence, nil
	}
}

func (m *MicSource) Close() error {
	if m.closed.CompareAndSwap(false, true) {
		m.mu.Lock()
		defer m.mu.Unlock()
		close(m.frameCh)
	}
	return nil
}

// SpeakerSink implements meowcaller.AudioSink for speaker playback.
type SpeakerSink struct {
	frameCh chan []float32
	closed  atomic.Bool
	mu      sync.Mutex
}

func NewSpeakerSink() *SpeakerSink {
	return &SpeakerSink{
		frameCh: make(chan []float32, 20),
	}
}

// WriteFrame consumes one decoded frame from the peer.
func (s *SpeakerSink) WriteFrame(frame []float32) error {
	if s.closed.Load() {
		return nil
	}
	cp := make([]float32, len(frame))
	copy(cp, frame)

	select {
	case s.frameCh <- cp:
	default:
		select {
		case <-s.frameCh:
		default:
		}
		s.frameCh <- cp
	}
	return nil
}

// Pull retrieves the next frame for device playback.
func (s *SpeakerSink) Pull() []float32 {
	select {
	case frame := <-s.frameCh:
		return frame
	default:
		return nil
	}
}

func (s *SpeakerSink) Close() error {
	if s.closed.CompareAndSwap(false, true) {
		s.mu.Lock()
		defer s.mu.Unlock()
		// Drain
		for len(s.frameCh) > 0 {
			<-s.frameCh
		}
	}
	return nil
}

// AudioPipeline manages real-time audio devices and streaming.
type AudioPipeline struct {
	Mic     *MicSource
	Speaker *SpeakerSink

	ctx            *malgo.AllocatedContext
	captureDevice  *malgo.Device
	playbackDevice *malgo.Device
	running        bool
	mu             sync.Mutex
}

func NewAudioPipeline() *AudioPipeline {
	return &AudioPipeline{
		Mic:     NewMicSource(),
		Speaker: NewSpeakerSink(),
	}
}

// Start initializes the native Linux audio capture and playback devices via malgo.
func (p *AudioPipeline) Start() error {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.running {
		return nil
	}

	// Always instantiate fresh, active mic source and speaker sink for each session
	p.Mic = NewMicSource()
	p.Speaker = NewSpeakerSink()

	ctx, err := malgo.InitContext(nil, malgo.ContextConfig{}, nil)
	if err != nil {
		log.Printf("[wa/audio] malgo.InitContext warning: %v, falling back to in-memory streams", err)
		p.running = true
		return nil
	}
	p.ctx = ctx

	// 1. Capture Device (Microphone)
	captureConfig := malgo.DefaultDeviceConfig(malgo.Capture)
	captureConfig.Capture.Format = malgo.FormatF32
	captureConfig.Capture.Channels = 1
	captureConfig.SampleRate = meowcaller.SampleRate
	captureConfig.Alsa.NoMMap = 1

	var captureSamples []float32
	var capMu sync.Mutex

	onCapture := func(pOutput, pInput []byte, frameCount uint32) {
		sampleCount := len(pInput) / 4
		if sampleCount == 0 {
			return
		}
		capMu.Lock()
		defer capMu.Unlock()

		for i := 0; i < sampleCount; i++ {
			bits := binary.LittleEndian.Uint32(pInput[i*4 : (i+1)*4])
			captureSamples = append(captureSamples, math.Float32frombits(bits))
			if len(captureSamples) >= meowcaller.FrameSamples {
				p.Mic.Push(captureSamples[:meowcaller.FrameSamples])
				captureSamples = captureSamples[meowcaller.FrameSamples:]
			}
		}
	}

	captureCallbacks := malgo.DeviceCallbacks{
		Data: onCapture,
	}

	device, err := malgo.InitDevice(p.ctx.Context, captureConfig, captureCallbacks)
	if err != nil {
		log.Printf("[wa/audio] Failed to init capture device: %v", err)
	} else {
		p.captureDevice = device
		if startErr := p.captureDevice.Start(); startErr != nil {
			log.Printf("[wa/audio] Failed to start capture device: %v", startErr)
		}
	}

	// 2. Playback Device (Speaker)
	playbackConfig := malgo.DefaultDeviceConfig(malgo.Playback)
	playbackConfig.Playback.Format = malgo.FormatF32
	playbackConfig.Playback.Channels = 1
	playbackConfig.SampleRate = meowcaller.SampleRate
	playbackConfig.Alsa.NoMMap = 1

	var playSamples []float32
	var playMu sync.Mutex

	onPlayback := func(pOutput, pInput []byte, frameCount uint32) {
		reqSamples := len(pOutput) / 4
		playMu.Lock()
		defer playMu.Unlock()

		for len(playSamples) < reqSamples {
			next := p.Speaker.Pull()
			if next == nil {
				break
			}
			playSamples = append(playSamples, next...)
		}

		for i := 0; i < reqSamples; i++ {
			var val float32
			if len(playSamples) > 0 {
				val = playSamples[0]
				playSamples = playSamples[1:]
			}
			binary.LittleEndian.PutUint32(pOutput[i*4:(i+1)*4], math.Float32bits(val))
		}
	}

	playbackCallbacks := malgo.DeviceCallbacks{
		Data: onPlayback,
	}

	playDev, err := malgo.InitDevice(p.ctx.Context, playbackConfig, playbackCallbacks)
	if err != nil {
		log.Printf("[wa/audio] Failed to init playback device: %v", err)
	} else {
		p.playbackDevice = playDev
		if startErr := p.playbackDevice.Start(); startErr != nil {
			log.Printf("[wa/audio] Failed to start playback device: %v", startErr)
		}
	}

	p.running = true
	return nil
}

// Stop shuts down audio capture and playback.
func (p *AudioPipeline) Stop() {
	p.mu.Lock()
	defer p.mu.Unlock()

	if !p.running {
		return
	}
	p.running = false

	if p.captureDevice != nil {
		_ = p.captureDevice.Stop()
		p.captureDevice.Uninit()
		p.captureDevice = nil
	}
	if p.playbackDevice != nil {
		_ = p.playbackDevice.Stop()
		p.playbackDevice.Uninit()
		p.playbackDevice = nil
	}
	if p.ctx != nil {
		_ = p.ctx.Uninit()
		p.ctx.Free()
		p.ctx = nil
	}

	if p.Mic != nil {
		_ = p.Mic.Close()
	}
	if p.Speaker != nil {
		_ = p.Speaker.Close()
	}
}
