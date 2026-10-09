import React from "react"
import { createPortal } from "react-dom"

interface DeleteMessageModalProps {
  isOpen: boolean
  isFromMe: boolean
  onClose: () => void
  onDeleteForEveryone: () => void
  onDeleteForMe: () => void
}

export const DeleteMessageModal: React.FC<DeleteMessageModalProps> = ({
  isOpen,
  isFromMe,
  onClose,
  onDeleteForEveryone,
  onDeleteForMe,
}) => {
  React.useEffect(() => {
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

  if (!isOpen) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl dark:bg-dark-secondary dark:text-gray-100"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-2">
          Delete message?
        </h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-6">
          {isFromMe
            ? "You can delete this message for everyone in this chat or only for yourself."
            : "This message will be removed from your chat history."}
        </p>

        <div className="flex flex-col gap-2">
          {isFromMe && (
            <button
              onClick={() => {
                onDeleteForEveryone()
                onClose()
              }}
              className="w-full rounded-xl bg-red-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-red-700 transition-colors cursor-pointer"
            >
              Delete for everyone
            </button>
          )}

          <button
            onClick={() => {
              onDeleteForMe()
              onClose()
            }}
            className={
              isFromMe
                ? "w-full rounded-xl bg-gray-100 dark:bg-dark-tertiary px-4 py-2.5 text-sm font-medium text-gray-800 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
                : "w-full rounded-xl bg-red-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-red-700 transition-colors cursor-pointer"
            }
          >
            Delete for me
          </button>

          <button
            onClick={onClose}
            className="w-full rounded-xl border border-gray-200 dark:border-white/10 px-4 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors cursor-pointer mt-1"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
