import {
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  forwardRef,
  useImperativeHandle,
} from "react"
import { createPortal } from "react-dom"
import {
  ReplyIcon,
  CopyIcon,
  ReactIcon,
  ForwardIcon,
  MenuArrowIcon,
  EditIcon,
  DeleteIcon,
} from "../../assets/svgs/message_menu_icons"

export interface MessageMenuHandle {
  openAt: (x: number, y: number) => void
  close: () => void
}

interface MessageMenuProps {
  messageId: string
  isFromMe: boolean
  isPinned?: boolean
  canEdit?: boolean
  onReply?: () => void
  onCopy?: () => void
  onReact?: () => void
  onForward?: () => void
  onPin?: () => void
  onEdit?: () => void
  onDelete?: () => void
}

// Same pin glyph as the chat list, sized for menu rows.
const PinMenuIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" className="fill-current">
    <path d="M16 3a1 1 0 0 1 .95 1.31l-.9 2.72 3.42 3.42a1 1 0 0 1-.21 1.57l-3.62 2.07-1.9 4.75a1 1 0 0 1-1.64.33L9 16.07l-4.29 4.3-1.42-1.42 4.3-4.29-3.1-3.1a1 1 0 0 1 .33-1.64l4.75-1.9 2.07-3.62A1 1 0 0 1 12.5 4z" />
  </svg>
)

export const MessageMenu = forwardRef<MessageMenuHandle, MessageMenuProps>(function MessageMenu(
  {
    messageId: _messageId,
    isFromMe,
    isPinned,
    canEdit,
    onReply,
    onCopy,
    onReact,
    onForward,
    onPin,
    onEdit,
    onDelete,
  }: MessageMenuProps,
  ref,
) {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [isClosing, setIsClosing] = useState(false)
  const [clickPos, setClickPos] = useState<{ x: number; y: number } | null>(null)
  const [menuPosition, setMenuPosition] = useState<{
    top: number
    left: number
    transformOrigin: string
  } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const closeMenu = () => {
    setIsClosing(true)
    setTimeout(() => {
      setIsMenuOpen(false)
      setIsClosing(false)
      setClickPos(null)
    }, 150)
  }

  useImperativeHandle(ref, () => ({
    openAt: (x: number, y: number) => {
      setClickPos({ x, y })
      setIsMenuOpen(true)
    },
    close: () => closeMenu(),
  }))

  useLayoutEffect(() => {
    if (isMenuOpen && dropdownRef.current) {
      const dropdownRect = dropdownRef.current.getBoundingClientRect()
      const viewportHeight = window.innerHeight
      const viewportWidth = window.innerWidth
      const height = dropdownRect.height
      const width = dropdownRect.width

      if (clickPos) {
        let left = clickPos.x
        let top = clickPos.y
        let origin = "top left"

        if (left + width > viewportWidth - 8) {
          left = Math.max(8, viewportWidth - width - 8)
          origin = "top right"
        }

        if (top + height > viewportHeight - 8) {
          top = Math.max(8, top - height)
          origin = origin.includes("right") ? "bottom right" : "bottom left"
        }

        setMenuPosition({ top, left, transformOrigin: origin })
        return
      }

      if (menuRef.current) {
        const buttonRect = menuRef.current.getBoundingClientRect()
        const spaceBelow = viewportHeight - buttonRect.bottom
        const spaceAbove = buttonRect.top

        let top = 0
        let left = isFromMe ? buttonRect.right - width : buttonRect.left
        let origin = isFromMe ? "top right" : "top left"

        if (spaceBelow < height && spaceAbove > height) {
          top = buttonRect.top - height - 4
          origin = isFromMe ? "bottom right" : "bottom left"
        } else {
          top = buttonRect.bottom + 4
        }

        setMenuPosition({ top, left, transformOrigin: origin })
      }
    } else if (!isMenuOpen) {
      setMenuPosition(null)
      setClickPos(null)
    }
  }, [isMenuOpen, isFromMe, clickPos])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        if (!menuRef.current || !menuRef.current.contains(event.target as Node)) {
          closeMenu()
        }
      }
    }
    const handleScroll = () => {
      closeMenu()
    }

    if (isMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside)
      window.addEventListener("scroll", handleScroll, true)
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
      window.removeEventListener("scroll", handleScroll, true)
    }
  }, [isMenuOpen])

  const handleMenuItemClick = (callback?: () => void) => {
    callback?.()
    closeMenu()
  }

  return (
    <div className="absolute top-1 right-1 z-10" ref={menuRef}>
      <button
        onClick={() => setIsMenuOpen(!isMenuOpen)}
        className="opacity-0 group-hover:opacity-100 transition-all duration-200 cursor-pointer p-1"
        aria-label="Message options"
      >
        <MenuArrowIcon />
      </button>

      {/* menu */}
      {isMenuOpen &&
        createPortal(
          <div
            ref={dropdownRef}
            className="fixed z-[9999] w-56 bg-white dark:bg-dark-secondary rounded-xl shadow-lg p-2"
            style={{
              top: menuPosition?.top ?? 0,
              left: menuPosition?.left ?? 0,
              visibility: menuPosition ? "visible" : "hidden",
              transformOrigin: menuPosition?.transformOrigin,
              animation: isClosing ? "menuFadeOut 0.15s ease-in" : "menuFadeIn 0.15s ease-out",
            }}
          >
            <button
              onMouseDown={e => e.preventDefault()}
              onClick={() => handleMenuItemClick(onReply)}
              className="rounded-xl w-full px-4 py-2.5 text-left flex items-center gap-3 hover:bg-gray-100 dark:hover:bg-dark-tertiary transition-colors text-gray-800 dark:text-gray-200 text-sm cursor-pointer"
            >
              <ReplyIcon />
              <span>Reply</span>
            </button>

            <button
              onMouseDown={e => e.preventDefault()}
              onClick={() => handleMenuItemClick(onCopy)}
              className="rounded-xl w-full px-4 py-2.5 text-left flex items-center gap-3 hover:bg-gray-100 dark:hover:bg-dark-tertiary transition-colors text-gray-800 dark:text-gray-200 text-sm cursor-pointer"
            >
              <CopyIcon />
              <span>Copy</span>
            </button>

            <button
              onMouseDown={e => e.preventDefault()}
              onClick={() => handleMenuItemClick(onReact)}
              className="rounded-xl w-full px-4 py-2.5 text-left flex items-center gap-3 hover:bg-gray-100 dark:hover:bg-dark-tertiary transition-colors text-gray-800 dark:text-gray-200 text-sm cursor-pointer"
            >
              <ReactIcon />
              <span>React</span>
            </button>

            {onForward && (
              <button
                onMouseDown={e => e.preventDefault()}
                onClick={() => handleMenuItemClick(onForward)}
                className="rounded-xl w-full px-4 py-2.5 text-left flex items-center gap-3 hover:bg-gray-100 dark:hover:bg-dark-tertiary transition-colors text-gray-800 dark:text-gray-200 text-sm cursor-pointer"
              >
                <ForwardIcon />
                <span>Forward</span>
              </button>
            )}

            {onPin && (
              <button
                onMouseDown={e => e.preventDefault()}
                onClick={() => handleMenuItemClick(onPin)}
                className="rounded-xl w-full px-4 py-2.5 text-left flex items-center gap-3 hover:bg-gray-100 dark:hover:bg-dark-tertiary transition-colors text-gray-800 dark:text-gray-200 text-sm cursor-pointer"
              >
                <PinMenuIcon />
                <span>{isPinned ? "Unpin" : "Pin"}</span>
              </button>
            )}

            {canEdit && onEdit && (
              <button
                onMouseDown={e => e.preventDefault()}
                onClick={() => handleMenuItemClick(onEdit)}
                className="rounded-xl w-full px-4 py-2.5 text-left flex items-center gap-3 hover:bg-gray-100 dark:hover:bg-dark-tertiary transition-colors text-gray-800 dark:text-gray-200 text-sm cursor-pointer"
              >
                <EditIcon />
                <span>Edit</span>
              </button>
            )}

            {onDelete && (
              <button
                onMouseDown={e => e.preventDefault()}
                onClick={() => handleMenuItemClick(onDelete)}
                className="rounded-xl w-full px-4 py-2.5 text-left flex items-center gap-3 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors text-red-600 dark:text-red-400 text-sm cursor-pointer"
              >
                <DeleteIcon />
                <span>Delete</span>
              </button>
            )}
          </div>,
          document.body,
        )}
    </div>
  )
})
