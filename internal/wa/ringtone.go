package wa

import (
	"context"
	_ "embed"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"time"
)

//go:embed assets/ringtone.ogg
var embeddedRingtoneOGG []byte

//go:embed assets/ringtone.wav
var embeddedRingtoneWAV []byte

//go:embed assets/ringing.ogg
var embeddedRingingOGG []byte

//go:embed assets/ringing.wav
var embeddedRingingWAV []byte

// RingtonePlayer handles native continuous ringtone playback on Linux
// for incoming calls (WhatsApp official ringtone) and outgoing calls (ringing tone),
// unaffected by WebKit autoplay policies.
type RingtonePlayer struct {
	mu                   sync.Mutex
	cancel               context.CancelFunc
	ringtonePath         string
	ringingPath          string
	incomingSoundEnabled func() bool
	outgoingSoundEnabled func() bool
}

func NewRingtonePlayer(incomingSoundEnabled, outgoingSoundEnabled func() bool) *RingtonePlayer {
	rp := &RingtonePlayer{
		incomingSoundEnabled: incomingSoundEnabled,
		outgoingSoundEnabled: outgoingSoundEnabled,
	}
	rp.ringtonePath, rp.ringingPath = rp.ensureAudioFiles()
	return rp
}

// ensureAudioFiles writes the embedded audio files to a cache/temp directory.
func (rp *RingtonePlayer) ensureAudioFiles() (string, string) {
	_, prefersWAV := findAudioPlayer()

	var ringtoneData, ringingData []byte
	var ringtoneExt, ringingExt string

	if prefersWAV {
		ringtoneData = embeddedRingtoneWAV
		ringingData = embeddedRingingWAV
		ringtoneExt = ".wav"
		ringingExt = ".wav"
	} else {
		ringtoneData = embeddedRingtoneOGG
		ringingData = embeddedRingingOGG
		ringtoneExt = ".ogg"
		ringingExt = ".ogg"
	}

	ringtonePath := filepath.Join(os.TempDir(), "whats4linux_ringtone"+ringtoneExt)
	ringingPath := filepath.Join(os.TempDir(), "whats4linux_ringing"+ringingExt)

	if info, err := os.Stat(ringtonePath); err != nil || info.Size() != int64(len(ringtoneData)) {
		_ = os.WriteFile(ringtonePath, ringtoneData, 0644)
	}

	if info, err := os.Stat(ringingPath); err != nil || info.Size() != int64(len(ringingData)) {
		_ = os.WriteFile(ringingPath, ringingData, 0644)
	}

	return ringtonePath, ringingPath
}

// StartRingtone initiates continuous looped playback of WhatsApp's incoming ringtone.
func (rp *RingtonePlayer) StartRingtone() {
	rp.mu.Lock()
	defer rp.mu.Unlock()

	rp.stopLocked()

	if rp.incomingSoundEnabled != nil && !rp.incomingSoundEnabled() {
		return
	}

	playerBin, _ := findAudioPlayer()
	if playerBin == "" || rp.ringtonePath == "" {
		return
	}

	ctx, cancel := context.WithCancel(context.Background())
	rp.cancel = cancel

	go func(ctx context.Context, bin, soundFile string) {
		for {
			select {
			case <-ctx.Done():
				return
			default:
			}

			cmd := exec.CommandContext(ctx, bin, soundFile)
			_ = cmd.Run()

			select {
			case <-ctx.Done():
				return
			case <-time.After(300 * time.Millisecond):
			}
		}
	}(ctx, playerBin, rp.ringtonePath)
}

// StartRinging initiates continuous looped playback of the outgoing calling ringback tone.
func (rp *RingtonePlayer) StartRinging() {
	rp.mu.Lock()
	defer rp.mu.Unlock()

	rp.stopLocked()

	if rp.outgoingSoundEnabled != nil && !rp.outgoingSoundEnabled() {
		return
	}

	playerBin, _ := findAudioPlayer()
	if playerBin == "" || rp.ringingPath == "" {
		return
	}

	ctx, cancel := context.WithCancel(context.Background())
	rp.cancel = cancel

	go func(ctx context.Context, bin, soundFile string) {
		for {
			select {
			case <-ctx.Done():
				return
			default:
			}

			cmd := exec.CommandContext(ctx, bin, soundFile)
			_ = cmd.Run()

			select {
			case <-ctx.Done():
				return
			case <-time.After(200 * time.Millisecond):
			}
		}
	}(ctx, playerBin, rp.ringingPath)
}

// Start is an alias for StartRingtone for backward compatibility.
func (rp *RingtonePlayer) Start() {
	rp.StartRingtone()
}

// Stop terminates active ringtone or ringing playback immediately.
func (rp *RingtonePlayer) Stop() {
	rp.mu.Lock()
	defer rp.mu.Unlock()
	rp.stopLocked()
}

func (rp *RingtonePlayer) stopLocked() {
	if rp.cancel != nil {
		rp.cancel()
		rp.cancel = nil
	}
}

func findAudioPlayer() (string, bool) {
	for _, bin := range []string{"pw-play", "paplay", "mpv", "canberra-gtk-play"} {
		if path, err := exec.LookPath(bin); err == nil {
			return path, false
		}
	}
	if path, err := exec.LookPath("aplay"); err == nil {
		return path, true
	}
	return "", false
}
