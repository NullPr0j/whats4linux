import React from "react"
import { useCategoryStore } from "../../store"

interface AssignCategoryModalProps {
  chatId: string | null
  chatName: string
  isOpen: boolean
  onClose: () => void
  onCreateNew: () => void
}

export const AssignCategoryModal: React.FC<AssignCategoryModalProps> = ({
  chatId,
  chatName,
  isOpen,
  onClose,
  onCreateNew,
}) => {
  const { categories, toggleChatInCategory } = useCategoryStore()

  if (!isOpen || !chatId) return null

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm bg-white dark:bg-[#111b21] rounded-2xl shadow-2xl border border-gray-200 dark:border-white/10 flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-white/10">
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              Assign to Category
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-64">
              {chatName || "Selected chat"}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/5 transition-colors"
          >
            ✕
          </button>
        </div>

        <div className="p-4 flex flex-col gap-2 max-h-72 overflow-y-auto">
          {categories.length === 0 ? (
            <div className="py-6 text-center text-xs text-gray-400">
              No custom categories yet
            </div>
          ) : (
            categories.map(cat => {
              const isInCat = cat.chatIds.includes(chatId)
              return (
                <label
                  key={cat.id}
                  className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-gray-50 dark:hover:bg-white/5 cursor-pointer transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={isInCat}
                    onChange={() => toggleChatInCategory(cat.id, chatId)}
                    className="w-4 h-4 rounded text-[#00a884] focus:ring-[#00a884] border-gray-300 dark:border-white/20 bg-transparent cursor-pointer"
                  />
                  <span className="text-sm font-medium text-gray-900 dark:text-gray-100 flex-1 truncate">
                    {cat.name}
                  </span>
                  <span className="text-xs text-gray-400">
                    {cat.chatIds.length} {cat.chatIds.length === 1 ? "chat" : "chats"}
                  </span>
                </label>
              )
            })
          )}
        </div>

        <div className="flex items-center justify-between px-5 py-3 border-t border-gray-200 dark:border-white/10 bg-gray-50/50 dark:bg-black/20">
          <button
            onClick={() => {
              onClose()
              onCreateNew()
            }}
            className="text-xs text-[#00a884] hover:underline flex items-center gap-1 font-medium"
          >
            <span>+</span>
            <span>New Category</span>
          </button>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl text-xs font-medium bg-[#00a884] hover:bg-[#008f72] text-white transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
