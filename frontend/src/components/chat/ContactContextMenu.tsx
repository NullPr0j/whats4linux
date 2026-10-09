import { useEffect, useRef } from "react"
import { createPortal } from "react-dom"

interface ContactContextMenuProps {
  x: number
  y: number
  onClose: () => void
  onMessageDirectly: () => void
  onViewProfile: () => void
  onViewPhoto?: () => void
  onCopyPhone?: () => void
  contactName?: string
  hasAvatar?: boolean
}

export function ContactContextMenu({
  x,
  y,
  onClose,
  onMessageDirectly,
  onViewProfile,
  onViewPhoto,
  onCopyPhone,
  contactName,
  hasAvatar,
}: ContactContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose()
      }
    }

    document.addEventListener("mousedown", handleClickOutside, true)
    document.addEventListener("keydown", handleKeyDown, true)
    return () => {
      document.removeEventListener("mousedown", handleClickOutside, true)
      document.removeEventListener("keydown", handleKeyDown, true)
    }
  }, [onClose])

  // Prevent overflowing window bounds
  const adjustedX = Math.min(x, window.innerWidth - 210)
  const adjustedY = Math.min(y, window.innerHeight - 200)

  return createPortal(
    <div
      ref={menuRef}
      style={{ left: `${Math.max(10, adjustedX)}px`, top: `${Math.max(10, adjustedY)}px` }}
      className="fixed z-[9999] min-w-[190px] rounded-xl bg-white/95 dark:bg-[#202c33]/95 backdrop-blur-md shadow-xl border border-gray-200/80 dark:border-white/10 py-1.5 text-sm text-gray-800 dark:text-[#e9edef] animate-in fade-in zoom-in-95 duration-100 select-none"
      onClick={e => e.stopPropagation()}
    >
      {contactName && (
        <div className="px-3.5 py-1.5 text-[11px] font-semibold text-gray-400 dark:text-[#8696a0] truncate border-b border-gray-100 dark:border-white/5 mb-1">
          {contactName}
        </div>
      )}

      <button
        onClick={() => {
          onMessageDirectly()
          onClose()
        }}
        className="w-full flex items-center gap-2.5 px-3.5 py-2 hover:bg-gray-100 dark:hover:bg-[#111b21]/70 transition-colors text-left cursor-pointer text-[13px]"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" className="text-[#00a884] shrink-0">
          <path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z" />
        </svg>
        <span>Message directly</span>
      </button>

      <button
        onClick={() => {
          onViewProfile()
          onClose()
        }}
        className="w-full flex items-center gap-2.5 px-3.5 py-2 hover:bg-gray-100 dark:hover:bg-[#111b21]/70 transition-colors text-left cursor-pointer text-[13px]"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" className="text-gray-500 dark:text-[#8696a0] shrink-0">
          <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
        </svg>
        <span>View profile</span>
      </button>

      {hasAvatar && onViewPhoto && (
        <button
          onClick={() => {
            onViewPhoto()
            onClose()
          }}
          className="w-full flex items-center gap-2.5 px-3.5 py-2 hover:bg-gray-100 dark:hover:bg-[#111b21]/70 transition-colors text-left cursor-pointer text-[13px]"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" className="text-blue-500 dark:text-blue-400 shrink-0">
            <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z" />
          </svg>
          <span>View profile photo</span>
        </button>
      )}

      {onCopyPhone && (
        <button
          onClick={() => {
            onCopyPhone()
            onClose()
          }}
          className="w-full flex items-center gap-2.5 px-3.5 py-2 hover:bg-gray-100 dark:hover:bg-[#111b21]/70 transition-colors text-left cursor-pointer text-[13px] border-t border-gray-100 dark:border-white/5 mt-1"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" className="text-gray-500 dark:text-[#8696a0] shrink-0">
            <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" />
          </svg>
          <span>Copy phone / JID</span>
        </button>
      )}
    </div>,
    document.body,
  )
}
