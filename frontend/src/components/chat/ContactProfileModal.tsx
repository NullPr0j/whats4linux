import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { GetProfile, GetCachedAvatar } from "../../../wailsjs/go/api/Api"
import { api } from "../../../wailsjs/go/models"
import { UserAvatar } from "../../assets/svgs/chat_icons"
import { useUIStore } from "../../store"

interface ContactProfileModalProps {
  jid: string
  isOpen: boolean
  onClose: () => void
  onMessageDirectly?: (jid: string, name: string, avatar?: string) => void
  onStartCall?: (jid: string, name: string) => void
}

export function ContactProfileModal({
  jid,
  isOpen,
  onClose,
  onMessageDirectly,
  onStartCall,
}: ContactProfileModalProps) {
  const [profile, setProfile] = useState<api.Contact | null>(null)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)
  const openLightbox = useUIStore(s => s.openLightbox)

  useEffect(() => {
    if (!isOpen || !jid) {
      setProfile(null)
      setAvatarUrl(null)
      return
    }

    let cancelled = false
    setProfile(null)
    setAvatarUrl(null)
    setLoading(true)
    setCopied(false)

    // Load profile info & avatar in parallel
    Promise.allSettled([
      GetProfile(jid),
      GetCachedAvatar(jid, false),
    ]).then(([profileRes, avatarRes]) => {
      if (cancelled) return
      if (profileRes.status === "fulfilled") {
        setProfile(profileRes.value)
      } else {
        setProfile(null)
      }
      if (avatarRes.status === "fulfilled" && avatarRes.value) {
        setAvatarUrl(avatarRes.value)
      } else if (profileRes.status === "fulfilled" && profileRes.value?.avatar_url) {
        setAvatarUrl(profileRes.value.avatar_url)
      } else {
        setAvatarUrl(null)
      }
      setLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [isOpen, jid])

  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener("keydown", handleKeyDown, true)
    return () => window.removeEventListener("keydown", handleKeyDown, true)
  }, [isOpen, onClose])

  if (!isOpen || !jid) return null

  const displayName =
    profile?.full_name || profile?.push_name || profile?.phno || jid.split("@")[0]

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleAvatarClick = () => {
    if (avatarUrl) {
      openLightbox(avatarUrl, "image")
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[9990] flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[380px] rounded-2xl bg-white dark:bg-[#111b21] shadow-2xl border border-gray-200/80 dark:border-white/10 overflow-hidden flex flex-col animate-in zoom-in-95 duration-150"
        onClick={e => e.stopPropagation()}
      >
        {/* Header bar */}
        <div className="px-5 py-4 border-b border-gray-100 dark:border-white/5 flex items-center justify-between bg-gray-50/50 dark:bg-[#202c33]/40">
          <h3 className="text-base font-semibold text-gray-800 dark:text-[#e9edef]">
            Contact info
          </h3>
          <button
            onClick={onClose}
            className="p-1 rounded-full text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-200/60 dark:hover:bg-white/10 transition-colors cursor-pointer"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        </div>

        {/* Profile Card Body */}
        <div className="p-6 flex flex-col items-center text-center">
          {/* Avatar with click to view */}
          <div className="relative group mb-4">
            <div
              onClick={handleAvatarClick}
              className={`w-28 h-28 rounded-full overflow-hidden bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-white shadow-md ${
                avatarUrl ? "cursor-zoom-in group-hover:ring-4 group-hover:ring-emerald-500/40 transition-all" : ""
              }`}
              title={avatarUrl ? "Click to view full photo" : ""}
            >
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt={displayName}
                  className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
                />
              ) : (
                <div className="w-16 h-16 text-gray-400 dark:text-gray-300">
                  <UserAvatar />
                </div>
              )}
            </div>
            {avatarUrl && (
              <span className="absolute bottom-0 right-0 bg-black/60 dark:bg-black/70 backdrop-blur-xs text-white p-1.5 rounded-full shadow pointer-events-none opacity-80 group-hover:opacity-100 transition-opacity">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                  <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z" />
                </svg>
              </span>
            )}
          </div>

          {/* Name & details */}
          <h2 className="text-lg font-bold text-gray-900 dark:text-[#e9edef] truncate max-w-full">
            {displayName}
          </h2>

          {profile?.push_name && profile.full_name && profile.push_name !== profile.full_name && (
            <p className="text-xs text-gray-400 dark:text-[#8696a0] mt-0.5">
              ~{profile.push_name}
            </p>
          )}

          {profile?.phno && (
            <p className="text-sm text-gray-600 dark:text-[#8696a0] font-mono mt-1">
              {profile.phno}
            </p>
          )}

          {profile?.is_business && (
            <div className="mt-2.5 inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 text-xs font-medium border border-emerald-200 dark:border-emerald-800/40">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
              </svg>
              Business Account
            </div>
          )}

          {/* Quick Action Buttons */}
          <div className="flex items-center justify-center gap-3 mt-6 w-full">
            {onMessageDirectly && (
              <button
                onClick={() => {
                  onMessageDirectly(jid, displayName, avatarUrl || undefined)
                  onClose()
                }}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-[#00a884] hover:bg-[#02906f] active:bg-[#007e63] text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer"
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                  <path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z" />
                </svg>
                Message
              </button>
            )}

            {onStartCall && !jid.endsWith("@g.us") && (
              <button
                onClick={() => {
                  onStartCall(jid, displayName)
                  onClose()
                }}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-gray-100 hover:bg-gray-200 dark:bg-[#202c33] dark:hover:bg-[#2a3942] text-gray-800 dark:text-[#e9edef] text-xs font-semibold transition-colors cursor-pointer"
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                  <path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 0 0-1.01.24l-2.2 2.2a15.053 15.053 0 0 1-6.59-6.59l2.2-2.21a.96.96 0 0 0 .25-1A11.36 11.36 0 0 1 8.5 3.93c.01-.54-.45-.99-.99-.99H4.06c-.55 0-1 .45-1 1 0 9.39 7.61 17 17 17 .55 0 1-.45 1-1v-3.56c0-.54-.45-.99-.99-.99z" />
                </svg>
                Call
              </button>
            )}

            <button
              onClick={() => handleCopy(profile?.phno || jid)}
              className="py-2.5 px-3 rounded-xl bg-gray-100 hover:bg-gray-200 dark:bg-[#202c33] dark:hover:bg-[#2a3942] text-gray-800 dark:text-[#e9edef] text-xs font-medium transition-colors cursor-pointer flex items-center gap-1.5"
              title="Copy phone number or identifier"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" />
              </svg>
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
