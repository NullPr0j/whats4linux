import { useEffect, useState, useMemo } from "react"
import { useCallStore, useChatStore } from "../../store"
import { GetCachedAvatar } from "../../../wailsjs/go/api/Api"
import { formatPhone } from "../../lib/utils"

export function IncomingCallModal() {
  const callState = useCallStore(s => s.callState)
  const peerName = useCallStore(s => s.peerName)
  const peerJid = useCallStore(s => s.peerJid)
  const acceptCall = useCallStore(s => s.acceptCall)
  const rejectCall = useCallStore(s => s.rejectCall)
  const chatsById = useChatStore(s => s.chatsById)

  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)

  // Resolve best contact name
  const displayName = useMemo(() => {
    // 1. If peerName is already a nice name (not raw digits / LID)
    if (peerName && !/^\d+$/.test(peerName.trim())) {
      return peerName
    }

    // 2. Lookup in chatsById by peerJid or matching user number
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

    // 3. If peerName exists, format phone if digits
    if (peerName) {
      const clean = peerName.trim()
      if (/^\d+$/.test(clean)) {
        return formatPhone(clean)
      }
      return peerName
    }

    // 4. If peerJid exists, format phone if digits
    if (peerJid) {
      const userNum = peerJid.split("@")[0].split(":")[0]
      if (/^\d+$/.test(userNum)) {
        return formatPhone(userNum)
      }
      return userNum
    }

    return "WhatsApp Contact"
  }, [peerName, peerJid, chatsById])

  useEffect(() => {
    if (callState !== "ringing_in" || !peerJid) {
      setAvatarUrl(null)
      return
    }

    // Check if chat has avatar in store
    const directChat = chatsById.get(peerJid)
    if (directChat?.avatar) {
      setAvatarUrl(directChat.avatar)
      return
    }

    // Try fetching cached avatar
    GetCachedAvatar(peerJid, true)
      .then(url => {
        if (url) setAvatarUrl(url)
      })
      .catch(() => {})
  }, [callState, peerJid, chatsById])

  useEffect(() => {
    if (callState !== "ringing_in") return

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation()
        rejectCall()
      } else if (e.key === "Enter") {
        e.stopPropagation()
        acceptCall()
      }
    }

    window.addEventListener("keydown", handleKey, true)
    return () => window.removeEventListener("keydown", handleKey, true)
  }, [callState, acceptCall, rejectCall])

  if (callState !== "ringing_in") return null

  return (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="relative w-80 rounded-3xl bg-white dark:bg-[#1f2c34] p-6 shadow-2xl border border-gray-100 dark:border-white/10 flex flex-col items-center text-center select-none animate-in zoom-in-95 duration-200">
        {/* Pulsing Avatar Container */}
        <div className="relative my-4 flex items-center justify-center">
          <div className="absolute w-24 h-24 rounded-full bg-emerald-500/20 animate-ping duration-1000" />
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={displayName}
              className="relative w-20 h-20 rounded-full object-cover shadow-lg border-2 border-white dark:border-[#1f2c34]"
            />
          ) : (
            <div className="relative w-20 h-20 rounded-full bg-[#00a884] flex items-center justify-center text-white text-2xl font-bold shadow-lg">
              {displayName.replace(/^\+/, "").substring(0, 1).toUpperCase() || "W"}
            </div>
          )}
        </div>

        {/* Caller Info */}
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 max-w-full truncate px-2">
          {displayName}
        </h3>
        <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400 mt-1 animate-pulse">
          Incoming Voice Call...
        </p>

        {/* Action Buttons */}
        <div className="flex items-center justify-center gap-10 mt-8 w-full">
          {/* Decline Button */}
          <button
            onClick={rejectCall}
            title="Decline (Esc)"
            className="flex flex-col items-center gap-1.5 group cursor-pointer"
          >
            <div className="w-14 h-14 rounded-full bg-red-500 hover:bg-red-600 active:scale-95 text-white flex items-center justify-center shadow-lg transition-transform">
              <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor">
                <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.996.996 0 0 1 0-1.41C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.39.39.39 1.02 0 1.41l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.74-1.69-1.36-2.67-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z" />
              </svg>
            </div>
            <span className="text-[11px] text-gray-500 dark:text-gray-400 font-medium">Decline</span>
          </button>

          {/* Accept Button */}
          <button
            onClick={acceptCall}
            title="Accept (Enter)"
            className="flex flex-col items-center gap-1.5 group cursor-pointer"
          >
            <div className="w-14 h-14 rounded-full bg-emerald-500 hover:bg-emerald-600 active:scale-95 text-white flex items-center justify-center shadow-lg transition-transform animate-bounce">
              <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor">
                <path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 0 0-1.01.24l-2.2 2.2a15.053 15.053 0 0 1-6.59-6.59l2.2-2.21a.96.96 0 0 0 .25-1A11.36 11.36 0 0 1 8.5 3.93c.01-.54-.45-.99-.99-.99H4.06c-.55 0-1 .45-1 1 0 9.39 7.61 17 17 17 .55 0 1-.45 1-1v-3.56c0-.54-.45-.99-.99-.99z" />
              </svg>
            </div>
            <span className="text-[11px] text-gray-500 dark:text-gray-400 font-medium">Accept</span>
          </button>
        </div>
      </div>
    </div>
  )
}
