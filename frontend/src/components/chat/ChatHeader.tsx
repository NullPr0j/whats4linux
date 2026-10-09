import { GoBackIcon } from "../../assets/svgs/header_icons"
import { InfoIcon } from "../../assets/svgs/chat_info_icons"
import { useUIStore } from "../../store"

interface ChatHeaderProps {
  chatName: string
  chatSubtitle?: string
  chatAvatar?: string
  onBack?: () => void
  onInfoClick?: () => void
  onCallClick?: () => void
}

export function ChatHeader({
  chatName,
  chatSubtitle,
  chatAvatar,
  onBack,
  onInfoClick,
  onCallClick,
}: ChatHeaderProps) {
  const openLightbox = useUIStore(s => s.openLightbox)

  const handleAvatarClick = (e: React.MouseEvent) => {
    if (chatAvatar) {
      e.stopPropagation()
      openLightbox(chatAvatar, "image")
    }
  }

  return (
    <div className="flex items-center justify-between p-3 bg-light-secondary dark:bg-dark-bg border-b border-gray-300 dark:border-white/5">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {onBack && (
          <button onClick={onBack} className="mr-4 md:hidden">
            <GoBackIcon />
          </button>
        )}
        <div className="flex items-center gap-3 cursor-pointer min-w-0" onClick={onInfoClick}>
          <div
            onClick={handleAvatarClick}
            className={`w-10 h-10 shrink-0 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center text-white font-bold overflow-hidden ${
              chatAvatar ? "hover:opacity-90 hover:ring-2 hover:ring-emerald-500/50 transition-all cursor-zoom-in" : ""
            }`}
            title={chatAvatar ? "Click to view full photo" : ""}
          >
            {chatAvatar ? (
              <img src={chatAvatar} alt={chatName} className="w-full h-full object-cover" />
            ) : (
              chatName.substring(0, 1).toUpperCase()
            )}
          </div>
          <div className="min-w-0">
            <h2 className="text-[16px] font-medium text-gray-800 dark:text-gray-100 truncate">
              {chatName}
            </h2>
            {chatSubtitle && (
              <div className="text-xs text-gray-500 dark:text-[#8696a0] truncate">
                {chatSubtitle}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        {onCallClick && (
          <button
            onClick={onCallClick}
            className="p-2 shrink-0 text-gray-600 dark:text-gray-300 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-gray-200 dark:hover:bg-dark-tertiary rounded-full transition-colors cursor-pointer"
            aria-label="Start voice call"
            title="Start voice call"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
              <path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 0 0-1.01.24l-2.2 2.2a15.053 15.053 0 0 1-6.59-6.59l2.2-2.21a.96.96 0 0 0 .25-1A11.36 11.36 0 0 1 8.5 3.93c.01-.54-.45-.99-.99-.99H4.06c-.55 0-1 .45-1 1 0 9.39 7.61 17 17 17 .55 0 1-.45 1-1v-3.56c0-.54-.45-.99-.99-.99z" />
            </svg>
          </button>
        )}
        <button
          onClick={onInfoClick}
          className="p-1 shrink-0 hover:bg-gray-200 dark:hover:bg-dark-tertiary rounded-full transition-colors"
          aria-label="Chat info"
        >
          <InfoIcon />
        </button>
      </div>
    </div>
  )
}
