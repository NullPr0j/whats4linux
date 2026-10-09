package wa

import (
	"testing"
	"time"

	"github.com/purpshell/meowcaller"
)

func TestMicSourceSilenceWhenMuted(t *testing.T) {
	mic := NewMicSource()
	defer mic.Close()

	// Push real audio sample
	sample := make([]float32, meowcaller.FrameSamples)
	for i := range sample {
		sample[i] = 0.5
	}
	mic.Push(sample)

	// When not muted, should receive non-zero frame
	frame, err := mic.ReadFrame()
	if err != nil {
		t.Fatalf("unexpected error reading frame: %v", err)
	}
	if len(frame) != meowcaller.FrameSamples {
		t.Fatalf("expected %d samples, got %d", meowcaller.FrameSamples, len(frame))
	}
	if frame[0] != 0.5 {
		t.Errorf("expected sample value 0.5, got %f", frame[0])
	}

	// Now mute
	mic.SetMute(true)
	mic.Push(sample)

	mutedFrame, err := mic.ReadFrame()
	if err != nil {
		t.Fatalf("unexpected error reading muted frame: %v", err)
	}
	for i, v := range mutedFrame {
		if v != 0 {
			t.Errorf("expected zero sample at index %d when muted, got %f", i, v)
			break
		}
	}
}

func TestSpeakerSinkWriteAndClose(t *testing.T) {
	sink := NewSpeakerSink()
	defer sink.Close()

	frame := make([]float32, meowcaller.FrameSamples)
	for i := range frame {
		frame[i] = 0.25
	}

	if err := sink.WriteFrame(frame); err != nil {
		t.Fatalf("WriteFrame failed: %v", err)
	}

	if err := sink.Close(); err != nil {
		t.Fatalf("Close failed: %v", err)
	}
}

func TestAudioPipelineLive(t *testing.T) {
	p := NewAudioPipeline()
	if err := p.Start(); err != nil {
		t.Fatalf("Start returned error: %v", err)
	}

	time.Sleep(500 * time.Millisecond)

	// Check if any frame was pushed to Mic
	select {
	case frame := <-p.Mic.frameCh:
		var sum float32
		for _, s := range frame {
			sum += s * s
		}
		t.Logf("Successfully captured frame of %d samples, energy: %f", len(frame), sum)
	default:
		t.Logf("WARNING: No audio frames captured from microphone in 500ms!")
	}

	p.Stop()
}
