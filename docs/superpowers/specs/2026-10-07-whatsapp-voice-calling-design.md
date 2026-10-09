# WhatsApp Voice Calling Design Spec (Approach 1: In-Process Integration)

## 1. Overview
This specification details the architecture, data flow, backend integration, audio pipeline, and user interface for enabling native WhatsApp 1-on-1 audio calling in `whats4linux` using `purpshell/meowcaller` and `meowcaller/audio/malgo`.

---

## 2. Architecture & Dependencies

### 2.1 Dependency Updates (`go.mod`)
- Transition the core WhatsApp protocol library from `go.mau.fi/whatsmeow` to `github.com/polymorfa/hypermeow`. `hypermeow` is an optimized fork that exposes the internal VoIP signaling node hooks and event structures necessary for `meowcaller`.
- Add `github.com/purpshell/meowcaller` which implements the WhatsApp Web VoIP stack, call state machine, and the pure-Go **MLOW** (Meta Low-latency Audio) codec.
- Audio capture and playback utilizes `meowcaller/audio/malgo` (miniaudio wrapper) for low-latency native audio device access on Linux (ALSA, PulseAudio, and PipeWire).

### 2.2 Call Manager Subsystem (`internal/wa/call.go`)
- Maintains the VoIP client wrapper and active call session:
  ```go
  type CallState string

  const (
      CallStateIdle       CallState = "idle"
      CallStateRingingIn  CallState = "ringing_in"
      CallStateRingingOut CallState = "ringing_out"
      CallStateConnected  CallState = "connected"
  )

  type CallSession struct {
      CallID    string    `json:"callId"`
      PeerJID   string    `json:"peerJid"`
      PeerName  string    `json:"peerName"`
      State     CallState `json:"state"`
      IsMuted   bool      `json:"isMuted"`
      StartedAt int64     `json:"startedAt,omitempty"`
  }

  type CallManager struct {
      caller     *meowcaller.Client
      activeCall *meowcaller.Call
      session    *CallSession
      mu         sync.Mutex
      audioDev   *AudioPipeline
  }
  ```
- **Lifecycle hooks**:
  - `OnIncomingCall`: Triggers when WhatsApp sends a call offer stanza. Stores the offer and emits `wa:call_incoming`.
  - `StartCall(targetJid)`: Validates JID, initiates outbound call via `caller.Call(ctx, targetJid)`, and sets `ringing_out`.
  - `AcceptCall()`: Invokes `call.Answer()`, initializes the audio devices, and transitions state to `connected`.
  - `RejectCall()`: Invokes `call.Reject()`, frees resources, and returns state to `idle`.
  - `EndCall()`: Invokes `call.Hangup()`, stops audio streams, and resets state.
  - `ToggleMute()`: Mutes or unmutes the local microphone stream without interrupting incoming audio playback.

### 2.3 Audio Pipeline (`internal/wa/audio.go`)
- **Microphone Stream**:
  - Captures 16 kHz / 48 kHz PCM audio from the system default input device using `malgo`.
  - Streams frames to `activeCall.Play()`.
  - When muted, streams zero-filled PCM buffers (silence) to maintain packet pacing.
- **Speaker Stream**:
  - Sets `activeCall.Receive()` to route incoming peer audio into the system default output device via `malgo`.
  - Ensures clean shutdown and device handle release when call terminates.

---

## 3. Wails Bridge & Inter-Process Communication

### 3.1 Backend API Methods (`api/call.go`)
Exported to frontend via Wails:
- `StartCall(chatId string) (*CallSession, error)`
- `AcceptCall() error`
- `RejectCall() error`
- `EndCall() error`
- `ToggleCallMute() (bool, error)`
- `GetCallStatus() *CallSession`

### 3.2 Wails Events
- `wa:call_incoming`: `{ callId, peerJid, peerName }`
- `wa:call_connected`: `{ callId, startedAt }`
- `wa:call_ended`: `{ callId, reason }` (`"hangup"`, `"rejected"`, `"busy"`, `"timeout"`)
- `wa:call_muted`: `{ isMuted }`

### 3.3 Desktop Notifications
- When `wa:call_incoming` fires, if the application window is minimized or unfocused, dispatch a desktop alert via `beeep.Notify` with caller information.

---

## 4. Frontend UI & UX

### 4.1 State Management (`useCallStore.ts`)
- Zustand store managing:
  - `status`: `'idle' | 'incoming' | 'outgoing' | 'connected'`
  - `session`: `CallSession | null`
  - `duration`: Call duration counter in seconds
  - Actions: `initiateCall()`, `accept()`, `reject()`, `hangup()`, `toggleMute()`

### 4.2 UI Components
1. **`ChatHeader.tsx` Call Button**:
   - Phone icon button displayed for 1-on-1 chats.
   - Triggers `initiateCall(chatId)`.
2. **`IncomingCallModal.tsx`**:
   - Displays caller avatar (with subtle pulse ring), contact name, and "WhatsApp Audio Call".
   - Plays gentle looping ringtone (synthesized via Web Audio API or bundled audio asset).
   - "Decline" button (red phone-down) and "Accept" button (green phone-up).
3. **`ActiveCallBar.tsx` (Floating Header / Pill)**:
   - Non-blocking floating bar fixed to top of window:
     - Avatar & Contact Name
     - Status: "Calling...", "Ringing...", or live timer `MM:SS`
     - Mute Microphone toggle button
     - End Call button (red)
   - Allows users to freely browse chats, type messages, and view media during the call.

---

## 5. Error Handling & Edge Cases
- **Simultaneous Calls**: If a call offer arrives while already on a call, automatically reply with busy status or reject.
- **Premature Hangup**: If caller hangs up before the user answers, `wa:call_ended` fires immediately, closing modal and stopping ringtone.
- **Device Failures**: If microphone or speaker initialization fails, report notification error to user and end call gracefully.
- **Network Drops**: If WhatsApp connection resets during call, terminate call and clean up audio buffers.
