import { describe, it, expect, beforeEach, vi } from "vitest"
import { useCallStore } from "./useCallStore"

describe("useCallStore", () => {
  beforeEach(() => {
    useCallStore.setState({
      callState: "idle",
      callId: null,
      peerJid: null,
      peerName: null,
      isMuted: false,
      duration: 0,
    })
  })

  it("has correct initial idle state", () => {
    const state = useCallStore.getState()
    expect(state.callState).toBe("idle")
    expect(state.callId).toBeNull()
    expect(state.isMuted).toBe(false)
  })

  it("handles incoming call event correctly", () => {
    useCallStore.getState().handleIncomingCall({
      callId: "call_abc123",
      peerJid: "1234567890@s.whatsapp.net",
      peerName: "Alice",
    })

    const state = useCallStore.getState()
    expect(state.callState).toBe("ringing_in")
    expect(state.callId).toBe("call_abc123")
    expect(state.peerJid).toBe("1234567890@s.whatsapp.net")
    expect(state.peerName).toBe("Alice")
  })

  it("handles connected call event correctly", () => {
    useCallStore.getState().handleIncomingCall({
      callId: "call_abc123",
      peerJid: "1234567890@s.whatsapp.net",
      peerName: "Alice",
    })

    useCallStore.getState().handleCallConnected({
      callId: "call_abc123",
    })

    const state = useCallStore.getState()
    expect(state.callState).toBe("connected")
    expect(state.callId).toBe("call_abc123")
  })

  it("handles mute toggle event", () => {
    useCallStore.getState().handleCallMuted({ isMuted: true })
    expect(useCallStore.getState().isMuted).toBe(true)

    useCallStore.getState().handleCallMuted({ isMuted: false })
    expect(useCallStore.getState().isMuted).toBe(false)
  })

  it("handles call ended event and cleans up state", () => {
    useCallStore.getState().handleIncomingCall({
      callId: "call_abc123",
      peerJid: "1234567890@s.whatsapp.net",
      peerName: "Alice",
    })

    useCallStore.getState().handleCallEnded({ callId: "call_abc123", reason: "hangup" })

    const state = useCallStore.getState()
    expect(state.callState).toBe("idle")
    expect(state.callId).toBeNull()
    expect(state.peerJid).toBeNull()
    expect(state.duration).toBe(0)
  })
})
