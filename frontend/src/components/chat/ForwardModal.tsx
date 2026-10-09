import { useState, useEffect, useMemo } from "react"
import { useUIStore, useChatStore } from "../../store"
import { ForwardMessage } from "../../../wailsjs/go/api/Api"
import { UserAvatar, GroupIcon, SearchIcon } from "../../assets/svgs/chat_icons"
import { ForwardIcon } from "../../assets/svgs/message_menu_icons"
import clsx from "clsx"

export function ForwardModal() {
  const forwardingMessageId = useUIStore(s => s.forwardingMessageId)
  const closeForwardModal = useUIStore(s => s.closeForwardModal)
  const addNotification = useUIStore(s => s.addNotification)
  const { chatIds, chatsById } = useChatStore()

  const [searchTerm, setSearchTerm] = useState("")
  const [selectedJids, setSelectedJids] = useState<Set<string>>(new Set())
  const [isSending, setIsSending] = useState(false)

  // Reset selections when modal opens/closes
  useEffect(() => {
    if (forwardingMessageId) {
      setSelectedJids(new Set())
      setSearchTerm("")
      setIsSending(false)
    }
  }, [forwardingMessageId])

  // Capture-phase ESC so the chat's own ESC handler doesn't fire too.
  useEffect(() => {
    if (!forwardingMessageId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation()
        closeForwardModal()
      }
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [forwardingMessageId, closeForwardModal])

  const chatsList = useMemo(() => {
    const all = chatIds.map(id => chatsById.get(id)).filter(Boolean)
    if (!searchTerm.trim()) return all
    const q = searchTerm.toLowerCase()
    return all.filter(c => c && (c.name?.toLowerCase().includes(q) || c.id?.toLowerCase().includes(q)))
  }, [chatIds, chatsById, searchTerm])

  if (!forwardingMessageId) return null

  const toggleSelect = (jid: string) => {
    setSelectedJids(prev => {
      const next = new Set(prev)
      if (next.has(jid)) next.delete(jid)
      else next.add(jid)
      return next
    })
  }

  const handleForward = async () => {
    if (selectedJids.size === 0 || isSending) return
    setIsSending(true)
    try {
      const jids = Array.from(selectedJids)
      await ForwardMessage(forwardingMessageId, jids)
      addNotification(`Message forwarded to ${jids.length} ${jids.length === 1 ? "chat" : "chats"}`)
      closeForwardModal()
    } catch (err: any) {
      console.error("Failed to forward message:", err)
      addNotification("Failed to forward message")
    } finally {
      setIsSending(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
      onClick={closeForwardModal}
    >
      <div
        className="w-full max-w-md bg-white dark:bg-[#111b21] rounded-2xl shadow-2xl border border-gray-200 dark:border-white/10 flex flex-col overflow-hidden max-h-[85vh] animate-in fade-in zoom-in-95 duration-150"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-white/10 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-full bg-green-500/10 text-green-600 dark:text-green-400">
              <ForwardIcon />
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                Forward message
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Choose chats to send this message to
              </p>
            </div>
          </div>
          <button
            onClick={closeForwardModal}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/5 transition-colors"
            title="Cancel (Esc)"
          >
            ✕
          </button>
        </div>

        {/* Search Bar */}
        <div className="px-4 py-2.5 border-b border-gray-100 dark:border-white/5 bg-gray-50 dark:bg-[#202c33]/40 shrink-0">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-white dark:bg-[#111b21] border border-gray-200 dark:border-gray-700 rounded-lg">
            <div className="w-4 h-4 text-gray-400 shrink-0">
              <SearchIcon />
            </div>
            <input
              type="text"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder="Search chats or contacts..."
              className="w-full bg-transparent border-0 outline-none text-sm text-gray-800 dark:text-gray-200 placeholder-gray-400"
              autoFocus
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm("")}
                className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Chats List */}
        <div className="flex-1 overflow-y-auto divide-y divide-gray-100 dark:divide-white/5 py-1">
          {chatsList.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-400">
              No matching chats found
            </div>
          ) : (
            chatsList.map(chat => {
              if (!chat) return null
              const isSelected = selectedJids.has(chat.id)
              return (
                <div
                  key={chat.id}
                  onClick={() => toggleSelect(chat.id)}
                  className={clsx(
                    "flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors select-none",
                    isSelected
                      ? "bg-green-50/70 dark:bg-green-950/20"
                      : "hover:bg-gray-100/70 dark:hover:bg-white/5",
                  )}
                >
                  {/* Avatar */}
                  <div className="w-10 h-10 rounded-full overflow-hidden bg-gray-200 dark:bg-gray-700 shrink-0 flex items-center justify-center">
                    {chat.avatar ? (
                      <img src={chat.avatar} alt="" className="w-full h-full object-cover" />
                    ) : chat.type === "group" ? (
                      <div className="p-2 text-gray-500 dark:text-gray-400">
                        <GroupIcon />
                      </div>
                    ) : (
                      <div className="p-2 text-gray-500 dark:text-gray-400">
                        <UserAvatar />
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0 text-left">
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                      {chat.name || chat.id}
                    </div>
                    {chat.lastMessage && (
                      <div className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">
                        {chat.lastMessage}
                      </div>
                    )}
                  </div>

                  {/* Custom Checkbox */}
                  <div
                    className={clsx(
                      "w-5 h-5 rounded-md border flex items-center justify-center transition-colors shrink-0",
                      isSelected
                        ? "bg-green-500 border-green-500 text-white"
                        : "border-gray-300 dark:border-gray-600 bg-transparent",
                    )}
                  >
                    {isSelected && (
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                        <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                      </svg>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-[#202c33] shrink-0">
          <div className="text-xs text-gray-500 dark:text-gray-400 font-medium">
            {selectedJids.size > 0
              ? `${selectedJids.size} ${selectedJids.size === 1 ? "chat" : "chats"} selected`
              : "Select at least 1 chat"}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={closeForwardModal}
              disabled={isSending}
              className="px-3.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleForward}
              disabled={selectedJids.size === 0 || isSending}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white text-sm font-medium transition-colors shadow-sm disabled:cursor-not-allowed"
            >
              {isSending ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Forwarding...</span>
                </>
              ) : (
                <>
                  <ForwardIcon />
                  <span>Forward</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
