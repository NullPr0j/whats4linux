import { useMemo } from "react"
import clsx from "clsx"
import { useCallStore, useChatStore } from "../../store"
import { formatPhone } from "../../lib/utils"

function formatCallTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`
}

export function ActiveCallBar() {
  const callState = useCallStore(s => s.callState)
  const peerName = useCallStore(s => s.peerName)
  const peerJid = useCallStore(s => s.peerJid)
  const isMuted = useCallStore(s => s.isMuted)
  const duration = useCallStore(s => s.duration)
  const toggleMute = useCallStore(s => s.toggleMute)
  const endCall = useCallStore(s => s.endCall)
  const chatsById = useChatStore(s => s.chatsById)

  const displayName = useMemo(() => {
    if (peerName && !/^\d+$/.test(peerName.trim())) {
      return peerName
    }
    if (peerJid) {
      const direct = chatsById.get(peerJid)
      if (direct?.name) return direct.name

      const userNum = peerJid.split("@")[0].split(":")[0]
      for (const c of chatsById.values()) {
        if (c.id.split("@")[0].split(":")[0] === userNum && c.name) {
          return c.name
        }
      }
    }
    if (peerName) {
      const clean = peerName.trim()
      if (/^\d+$/.test(clean)) {
        return formatPhone(clean)
      }
      return peerName
    }
    if (peerJid) {
      const userNum = peerJid.split("@")[0].split(":")[0]
      if (/^\d+$/.test(userNum)) {
        return formatPhone(userNum)
      }
      return userNum
    }
    return "WhatsApp Contact"
  }, [peerName, peerJid, chatsById])

  if (callState !== "ringing_out" && callState !== "connected") {
    return null
  }

  const isConnected = callState === "connected"

  return (
    <div className="fixed top-4 right-6 z-[9998] flex items-center gap-3.5 px-4 py-2.5 rounded-2xl bg-white/95 dark:bg-[#202c33]/95 backdrop-blur-md shadow-xl border border-gray-200 dark:border-white/10 select-none animate-in slide-in-from-top-3 duration-200">
      {/* Call Status Indicator */}
      <div className="relative flex items-center justify-center">
        <span
          className={clsx(
            "w-3 h-3 rounded-full",
            isConnected ? "bg-emerald-500 animate-pulse" : "bg-amber-400 animate-ping",
          )}
        />
      </div>

      {/* Info Column */}
      <div className="flex flex-col min-w-[100px] max-w-[180px]">
        <span className="text-xs font-semibold text-gray-800 dark:text-gray-100 truncate">
          {displayName}
        </span>
        <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400">
          {isConnected ? formatCallTime(duration) : "Calling..."}
        </span>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pl-1 border-l border-gray-200 dark:border-white/10">
        {/* Mute Button */}
        <button
          onClick={toggleMute}
          title={isMuted ? "Unmute microphone" : "Mute microphone"}
          className={clsx(
            "p-2 rounded-full transition-colors cursor-pointer",
            isMuted
              ? "bg-red-500/15 text-red-500 hover:bg-red-500/25"
              : "bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/20",
          )}
        >
          {isMuted ? (
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
              <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
              <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.91-3c-.49 0-.9.36-.98.85C16.52 14.2 14.47 16 12 16s-4.52-1.8-4.93-4.15c-.08-.49-.49-.85-.98-.85-.61 0-1.09.54-1 1.14.49 3 2.89 5.35 5.91 5.78V20c0 .55.45 1 1 1s1-.45 1-1v-2.08c3.02-.43 5.42-2.78 5.91-5.78.09-.6-.39-1.14-1-1.14z" />
            </svg>
          )}
        </button>

        {/* End Call Button */}
        <button
          onClick={endCall}
          title="End Call"
          className="p-2 rounded-full bg-red-500 hover:bg-red-600 text-white transition-colors cursor-pointer shadow-sm active:scale-95"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.996.996 0 0 1 0-1.41C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.39.39.39 1.02 0 1.41l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.74-1.69-1.36-2.67-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z" />
          </svg>
        </button>
      </div>
    </div>
  )
}
