import { create } from "zustand"
import {
  StartCall,
  AcceptCall,
  RejectCall,
  EndCall,
  ToggleCallMute,
  GetCallStatus,
} from "../../wailsjs/go/api/Api"
import { EventsOn } from "../../wailsjs/runtime/runtime"
import { playRingtone, stopRingtone } from "../lib/ringtone"
import { useAppSettingsStore } from "./useAppSettingsStore"

export type CallState = "idle" | "ringing_in" | "ringing_out" | "connected"

interface CallStore {
  callState: CallState
  callId: string | null
  peerJid: string | null
  peerName: string | null
  isMuted: boolean
  duration: number

  startCall: (chatId: string, contactName?: string) => Promise<void>
  acceptCall: () => Promise<void>
  rejectCall: () => Promise<void>
  endCall: () => Promise<void>
  toggleMute: () => Promise<void>

  handleIncomingCall: (data: { callId: string; peerJid: string; peerName?: string }) => void
  handleCallConnected: (data: { callId: string; startedAt?: number }) => void
  handleCallEnded: (data: { callId: string; reason?: string }) => void
  handleCallMuted: (data: { isMuted: boolean }) => void

  initEventListeners: () => () => void
}

let durationTimer: number | null = null

function startDurationCounter(set: (fn: (s: CallStore) => Partial<CallStore>) => void) {
  if (durationTimer !== null) {
    clearInterval(durationTimer)
  }
  durationTimer = setInterval(() => {
    set(state => ({ duration: state.duration + 1 }))
  }, 1000) as unknown as number
}

function stopDurationCounter() {
  if (durationTimer !== null) {
    clearInterval(durationTimer)
    durationTimer = null
  }
}

export const useCallStore = create<CallStore>((set, get) => ({
  callState: "idle",
  callId: null,
  peerJid: null,
  peerName: null,
  isMuted: false,
  duration: 0,

  startCall: async (chatId, contactName) => {
    try {
      set({
        callState: "ringing_out",
        peerJid: chatId,
        peerName: contactName || chatId,
        duration: 0,
        isMuted: false,
      })
      const session = await StartCall(chatId)
      if (session) {
        set({
          callId: session.callId,
          peerJid: session.peerJid,
          peerName: session.peerName || contactName || chatId,
        })
      }
    } catch (err) {
      console.error("Failed to start call:", err)
      get().handleCallEnded({ callId: "", reason: "failed" })
    }
  },

  acceptCall: async () => {
    stopRingtone()
    try {
      await AcceptCall()
      set({ callState: "connected", duration: 0 })
      startDurationCounter(set)
    } catch (err) {
      console.error("Failed to accept call:", err)
      get().handleCallEnded({ callId: get().callId || "", reason: "failed" })
    }
  },

  rejectCall: async () => {
    stopRingtone()
    get().handleCallEnded({ callId: get().callId || "", reason: "rejected" })
    try {
      await RejectCall()
    } catch (err) {
      console.error("Failed to reject call:", err)
    }
  },

  endCall: async () => {
    stopRingtone()
    stopDurationCounter()
    get().handleCallEnded({ callId: get().callId || "", reason: "hangup" })
    try {
      await EndCall()
    } catch (err) {
      console.error("Failed to end call:", err)
    }
  },

  toggleMute: async () => {
    try {
      const isMuted = await ToggleCallMute()
      set({ isMuted })
    } catch (err) {
      console.error("Failed to toggle mute:", err)
    }
  },

  handleIncomingCall: data => {
    set({
      callState: "ringing_in",
      callId: data.callId,
      peerJid: data.peerJid,
      peerName: data.peerName || data.peerJid,
      duration: 0,
      isMuted: false,
    })
    if (useAppSettingsStore.getState().incomingCallSounds) {
      playRingtone()
    }
  },

  handleCallConnected: () => {
    stopRingtone()
    set({ callState: "connected", duration: 0 })
    startDurationCounter(set)
  },

  handleCallEnded: () => {
    stopRingtone()
    stopDurationCounter()
    set({
      callState: "idle",
      callId: null,
      peerJid: null,
      peerName: null,
      isMuted: false,
      duration: 0,
    })
  },

  handleCallMuted: data => {
    set({ isMuted: data.isMuted })
  },

  initEventListeners: () => {
    // Initial sync
    GetCallStatus().then(status => {
      if (status && status.state && status.state !== "idle") {
        set({
          callState: status.state as CallState,
          callId: status.callId,
          peerJid: status.peerJid,
          peerName: status.peerName,
          isMuted: status.isMuted,
        })
        if (status.state === "connected") {
          startDurationCounter(set)
        } else if (status.state === "ringing_in") {
          if (useAppSettingsStore.getState().incomingCallSounds) {
            playRingtone()
          }
        }
      }
    }).catch(() => {})

    const unsubs = [
      EventsOn("wa:call_incoming", (data: any) => get().handleIncomingCall(data)),
      EventsOn("wa:call_connected", (data: any) => get().handleCallConnected(data)),
      EventsOn("wa:call_ended", (data: any) => get().handleCallEnded(data)),
      EventsOn("wa:call_muted", (data: any) => get().handleCallMuted(data)),
    ]

    return () => {
      stopRingtone()
      stopDurationCounter()
      unsubs.forEach(unsub => unsub())
    }
  },
}))
