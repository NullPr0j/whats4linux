import React, { useState, useMemo, useEffect } from "react"
import { useCategoryStore, useChatStore, type ChatCategory } from "../../store"
import { SearchIcon, UserAvatar, GroupIcon } from "../../assets/svgs/chat_icons"
import clsx from "clsx"

interface CategoryModalProps {
  category?: ChatCategory | null
  isOpen: boolean
  onClose: () => void
}

export const CategoryModal: React.FC<CategoryModalProps> = ({
  category,
  isOpen,
  onClose,
}) => {
  const { createCategory, updateCategory, deleteCategory } = useCategoryStore()
  const chatIds = useChatStore(state => state.chatIds)
  const chatsById = useChatStore(state => state.chatsById)

  const [name, setName] = useState("")
  const [selectedChatIds, setSelectedChatIds] = useState<Set<string>>(new Set())
  const [searchTerm, setSearchTerm] = useState("")

  useEffect(() => {
    if (isOpen) {
      if (category) {
        setName(category.name)
        setSelectedChatIds(new Set(category.chatIds))
      } else {
        setName("")
        setSelectedChatIds(new Set())
      }
      setSearchTerm("")
    }
  }, [isOpen, category])

  // Capture-phase ESC to close
  useEffect(() => {
    if (!isOpen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener("keydown", onKeyDown, true)
    return () => window.removeEventListener("keydown", onKeyDown, true)
  }, [isOpen, onClose])

  const chatsList = useMemo(() => {
    const all = chatIds.map(id => chatsById.get(id)).filter(Boolean)
    if (!searchTerm.trim()) return all
    const q = searchTerm.toLowerCase()
    return all.filter(
      c =>
        c &&
        (c.name?.toLowerCase().includes(q) || c.id?.toLowerCase().includes(q)),
    )
  }, [chatIds, chatsById, searchTerm])

  if (!isOpen) return null

  const toggleSelect = (id: string) => {
    setSelectedChatIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleSave = () => {
    const trimmed = name.trim()
    if (!trimmed) return

    const ids = Array.from(selectedChatIds)
    if (category) {
      updateCategory(category.id, trimmed, ids)
    } else {
      createCategory(trimmed, ids)
    }
    onClose()
  }

  const handleDelete = () => {
    if (category) {
      deleteCategory(category.id)
    }
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-white dark:bg-[#111b21] rounded-2xl shadow-2xl border border-gray-200 dark:border-white/10 flex flex-col overflow-hidden max-h-[85vh] animate-in fade-in zoom-in-95 duration-150"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-white/10 shrink-0">
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              {category ? "Edit Category" : "New Category"}
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Chats in this category will display whenever it is selected
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/5 transition-colors"
            title="Close"
          >
            ✕
          </button>
        </div>

        {/* Name input */}
        <div className="px-5 pt-4 pb-2 shrink-0">
          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
            Category Name
          </label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Work, Family, College, Important"
            autoFocus
            className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-[#202c33] border border-gray-300 dark:border-transparent rounded-xl text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-hidden focus:ring-2 focus:ring-[#00a884]"
          />
        </div>

        {/* Search chats */}
        <div className="px-5 py-2 shrink-0">
          <div className="relative flex items-center">
            <span className="absolute left-3 text-gray-400">
              <SearchIcon />
            </span>
            <input
              type="text"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder="Search chats to add..."
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-gray-100 dark:bg-[#202c33] border border-transparent rounded-lg text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-hidden focus:ring-1 focus:ring-[#00a884]"
            />
          </div>
        </div>

        {/* Selected count info */}
        <div className="px-5 py-1 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 shrink-0">
          <span>{selectedChatIds.size} chats selected</span>
          {selectedChatIds.size > 0 && (
            <button
              onClick={() => setSelectedChatIds(new Set())}
              className="text-[#00a884] hover:underline"
            >
              Clear all
            </button>
          )}
        </div>

        {/* Chat List */}
        <div className="flex-1 overflow-y-auto px-3 py-2 divide-y divide-gray-100 dark:divide-white/5">
          {chatsList.length === 0 ? (
            <div className="p-8 text-center text-xs text-gray-400">
              No chats found
            </div>
          ) : (
            chatsList.map(chat => {
              if (!chat) return null
              const isSelected = selectedChatIds.has(chat.id)
              const isGroup = chat.type === "group" || chat.id.endsWith("@g.us")
              return (
                <div
                  key={chat.id}
                  onClick={() => toggleSelect(chat.id)}
                  className="flex items-center gap-3 px-2 py-2 hover:bg-gray-50 dark:hover:bg-white/5 rounded-xl cursor-pointer transition-colors"
                >
                  {/* Checkbox */}
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => {}}
                    className="w-4 h-4 rounded text-[#00a884] focus:ring-[#00a884] border-gray-300 dark:border-white/20 bg-transparent cursor-pointer"
                  />

                  {/* Avatar */}
                  <div className="w-9 h-9 rounded-full overflow-hidden bg-gray-300 dark:bg-zinc-700 shrink-0 flex items-center justify-center">
                    {chat.avatar ? (
                      <img
                        src={chat.avatar}
                        alt={chat.name}
                        className="w-full h-full object-cover"
                      />
                    ) : isGroup ? (
                      <GroupIcon />
                    ) : (
                      <UserAvatar />
                    )}
                  </div>

                  {/* Name */}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                      {chat.name || chat.id}
                    </div>
                    {isGroup && (
                      <div className="text-[11px] text-gray-400 truncate">
                        Group
                      </div>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-gray-200 dark:border-white/10 shrink-0 bg-gray-50/50 dark:bg-black/20">
          {category ? (
            <button
              onClick={handleDelete}
              className="text-xs text-red-600 dark:text-red-400 hover:underline px-2 py-1.5"
            >
              Delete Category
            </button>
          ) : (
            <div />
          )}

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/10 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!name.trim()}
              className={clsx(
                "px-4 py-2 rounded-xl text-xs font-medium text-white transition-all shadow-sm",
                name.trim()
                  ? "bg-[#00a884] hover:bg-[#008f72] cursor-pointer"
                  : "bg-gray-400 dark:bg-zinc-700 opacity-60 cursor-not-allowed",
              )}
            >
              Save Category
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
