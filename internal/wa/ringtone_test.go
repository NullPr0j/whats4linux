package wa

import (
	"os"
	"testing"
	"time"
)

func TestRingtonePlayer_EnsureAudioFiles(t *testing.T) {
	rp := NewRingtonePlayer(func() bool { return true }, func() bool { return true })
	if rp.ringtonePath == "" {
		t.Fatal("expected non-empty ringtonePath")
	}
	if rp.ringingPath == "" {
		t.Fatal("expected non-empty ringingPath")
	}

	info1, err := os.Stat(rp.ringtonePath)
	if err != nil || info1.Size() == 0 {
		t.Fatalf("expected ringtone file to exist with >0 size, got err=%v", err)
	}

	info2, err := os.Stat(rp.ringingPath)
	if err != nil || info2.Size() == 0 {
		t.Fatalf("expected ringing file to exist with >0 size, got err=%v", err)
	}
}

func TestRingtonePlayer_StartAndStop(t *testing.T) {
	rp := NewRingtonePlayer(func() bool { return true }, func() bool { return true })

	// Test StartRingtone then Stop
	rp.StartRingtone()
	time.Sleep(50 * time.Millisecond)
	rp.Stop()

	// Test StartRinging then Stop
	rp.StartRinging()
	time.Sleep(50 * time.Millisecond)
	rp.Stop()

	// Calling Stop multiple times should be safe
	rp.Stop()
}

func TestRingtonePlayer_SoundDisabled(t *testing.T) {
	rp := NewRingtonePlayer(func() bool { return false }, func() bool { return false })

	rp.StartRingtone()
	if rp.cancel != nil {
		t.Error("expected no playback when incoming sound is disabled")
	}

	rp.StartRinging()
	if rp.cancel != nil {
		t.Error("expected no playback when outgoing sound is disabled")
	}
}
