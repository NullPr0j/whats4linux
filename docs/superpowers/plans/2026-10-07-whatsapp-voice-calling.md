# WhatsApp Voice Calling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement native 1-on-1 WhatsApp voice calling in `whats4linux` using `purpshell/meowcaller`, `hypermeow`, and `malgo` audio streaming.

**Architecture:** The Go backend manages VoIP signaling via `meowcaller` wrapped around the active client, piping full-duplex microphone and speaker audio through `malgo` on Linux. The frontend interacts via Wails methods and event listeners to show incoming call modals, active floating call controls, and a header call trigger.

**Tech Stack:** Go 1.26, `github.com/polymorfa/hypermeow`, `github.com/purpshell/meowcaller`, `malgo` (miniaudio), Wails v2, React 18, TypeScript, TailwindCSS, Zustand.

**Spec:** `docs/superpowers/specs/2026-10-07-whatsapp-voice-calling-design.md`

## Global Constraints
- Pure Go for protocol handling; minimal CGO for miniaudio playback/recording.
- Audio sample rate: 16kHz / 48kHz PCM mono/stereo compatible with WhatsApp MLOW codec.
- Desktop notifications must use existing `beeep` library.
- Frontend must maintain responsiveness: call bar must be floating and non-blocking.

---

### Task 1: Dependencies Setup (`go.mod`)

**Files:**
- Modify: `go.mod`
- Modify: `internal/wa/client.go`

**Interfaces:**
- Consumes: Current `whatsmeow` imports
- Produces: `hypermeow` client and `meowcaller` modules available for build

- [ ] **Step 1: Update go.mod to use hypermeow and meowcaller**

Update `go.mod` to reference `github.com/polymorfa/hypermeow` and `github.com/purpshell/meowcaller`:
```bash
go get github.com/polymorfa/hypermeow@v0.0.0-20260906031440-90f9e4ec2c88
go get github.com/purpshell/meowcaller@latest
go mod tidy
```

- [ ] **Step 2: Update internal/wa/client.go to import hypermeow**

Update package imports in `internal/wa/client.go` from `go.mau.fi/whatsmeow` to `github.com/polymorfa/hypermeow`.

- [ ] **Step 3: Verify module compilation**

Run: `go build ./internal/wa/...`
Expected: PASS (zero compilation errors)

---

### Task 2: Audio Pipeline (`internal/wa/audio.go`)

**Files:**
- Create: `internal/wa/audio.go`
- Create: `internal/wa/audio_test.go`

**Interfaces:**
- Consumes: `malgo` miniaudio context
- Produces: `AudioPipeline` struct with `Start()`, `Stop()`, `SetMute(bool)`

- [ ] **Step 1: Write test for AudioPipeline interface and mute buffer logic**

Create `internal/wa/audio_test.go` verifying silence generation when muted.

- [ ] **Step 2: Implement AudioPipeline in internal/wa/audio.go**

Implement native capture (microphone) and playback (speaker) device initialization and PCM frame streaming.

- [ ] **Step 3: Run audio tests**

Run: `go test -v ./internal/wa -run TestAudio`
Expected: PASS

---

### Task 3: Call Manager State Machine (`internal/wa/call.go`)

**Files:**
- Create: `internal/wa/call.go`
- Create: `internal/wa/call_test.go`

**Interfaces:**
- Consumes: `AudioPipeline`, `*meowcaller.Client`
- Produces: `CallManager` with `StartCall`, `AcceptCall`, `RejectCall`, `EndCall`, `ToggleMute`

- [ ] **Step 1: Write failing unit test for CallManager transitions**

Create `internal/wa/call_test.go` testing idle -> ringing_out -> connected -> idle state transitions.

- [ ] **Step 2: Implement CallManager in internal/wa/call.go**

Implement call lifecycle handlers, wrapping `client.OnIncomingCall` and connecting `AudioPipeline`.

- [ ] **Step 3: Run call manager tests**

Run: `go test -v ./internal/wa -run TestCallManager`
Expected: PASS

---

### Task 4: Wails API Bridge (`api/call.go`)

**Files:**
- Create: `api/call.go`
- Modify: `api/api.go`

**Interfaces:**
- Consumes: `CallManager`
- Produces: Exported Wails methods: `StartCall`, `AcceptCall`, `RejectCall`, `EndCall`, `ToggleCallMute`, `GetCallStatus`

- [ ] **Step 1: Implement Wails calling methods in api/call.go**

Expose JSON-serializable methods and wire `runtime.EventsEmit` for `wa:call_incoming`, `wa:call_connected`, `wa:call_ended`, and `wa:call_muted`.

- [ ] **Step 2: Register CallManager in api/api.go**

Initialize `CallManager` in `Api.Startup` and wire `beeep.Notify` for incoming calls when window is not focused.

- [ ] **Step 3: Verify backend build and Wails bindings**

Run: `go build ./...`
Expected: PASS

---

### Task 5: Frontend Call Store & Audio Tone (`useCallStore.ts`, `ringtone.ts`)

**Files:**
- Create: `frontend/src/store/useCallStore.ts`
- Create: `frontend/src/lib/ringtone.ts`
- Create: `frontend/src/store/useCallStore.test.ts`

**Interfaces:**
- Consumes: Wails events and `wailsjs/go/api/Api`
- Produces: Zustand hook `useCallStore` with reactive call state and actions

- [ ] **Step 1: Write unit tests for useCallStore**

Create `frontend/src/store/useCallStore.test.ts` testing state transitions on simulated Wails events.

- [ ] **Step 2: Implement Web Audio ringtone in frontend/src/lib/ringtone.ts**

Synthesize pleasant periodic ringtone chime via Web Audio `OscillatorNode` / `GainNode` with `playRingtone()` and `stopRingtone()`.

- [ ] **Step 3: Implement useCallStore in frontend/src/store/useCallStore.ts**

Subscribe to Wails runtime events (`wa:call_*`) and export call actions.

- [ ] **Step 4: Run frontend tests**

Run: `pnpm test`
Expected: PASS

---

### Task 6: Frontend UI Components (`IncomingCallModal.tsx`, `ActiveCallBar.tsx`, `ChatHeader.tsx`)

**Files:**
- Create: `frontend/src/components/chat/IncomingCallModal.tsx`
- Create: `frontend/src/components/chat/ActiveCallBar.tsx`
- Modify: `frontend/src/components/chat/ChatHeader.tsx`
- Modify: `frontend/src/screens/ChatDetail.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `useCallStore`
- Produces: Rendered call UI across the application

- [ ] **Step 1: Create IncomingCallModal component**

Modal displaying caller info, pulsing avatar, ringtone trigger, and Accept/Decline action buttons.

- [ ] **Step 2: Create ActiveCallBar component**

Floating pill with duration counter, mute toggle button, and red End Call button.

- [ ] **Step 3: Add Call Button to ChatHeader.tsx**

Render phone icon button next to contact title for direct 1-on-1 audio dialing.

- [ ] **Step 4: Mount call components in App.tsx**

Mount `<IncomingCallModal />` and `<ActiveCallBar />` at top level in `App.tsx`.

---

### Task 7: Full System Verification

**Files:**
- None (verification step)

- [ ] **Step 1: Run frontend tests and typecheck**

Run: `cd frontend && pnpm test && pnpm run build`
Expected: PASS with 0 errors.

- [ ] **Step 2: Compile native binary**

Run: `./scripts/build.sh`
Expected: `build/bin/whats4linux` built successfully.
