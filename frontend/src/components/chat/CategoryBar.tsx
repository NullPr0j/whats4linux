import React, { useState, useRef, useEffect } from "react"
import clsx from "clsx"
import { useCategoryStore, type ChatCategory } from "../../store"

interface CategoryBarProps {
  onOpenCreate: () => void
  onOpenEdit: (category: ChatCategory) => void
}

export const CategoryBar: React.FC<CategoryBarProps> = ({
  onOpenCreate,
  onOpenEdit,
}) => {
  const { categories, activeCategoryId, setActiveCategory, deleteCategory } =
    useCategoryStore()

  const [menuCat, setMenuCat] = useState<{
    cat: ChatCategory
    x: number
    y: number
  } | null>(null)

  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!menuCat) return
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuCat(null)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [menuCat])

  const handleCategoryContextMenu = (
    e: React.MouseEvent,
    cat: ChatCategory,
  ) => {
    e.preventDefault()
    e.stopPropagation()
    setMenuCat({ cat, x: e.clientX, y: e.clientY })
  }

  return (
    <div className="flex items-center gap-1.5 px-3 py-2 overflow-x-auto no-scrollbar border-b border-gray-100 dark:border-white/5 select-none shrink-0">
      {/* All */}
      <button
        onClick={() => setActiveCategory("all")}
        className={clsx(
          "rounded-full px-3 py-1 text-xs font-medium transition-colors cursor-pointer shrink-0",
          activeCategoryId === "all"
            ? "bg-[#d9fdd3] text-[#0a1014] font-semibold dark:bg-[#103629] dark:text-[#25d366]"
            : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-white/5 dark:text-[#8696a0] dark:hover:bg-white/10",
        )}
      >
        All
      </button>

      {/* Unread */}
      <button
        onClick={() => setActiveCategory("unread")}
        className={clsx(
          "rounded-full px-3 py-1 text-xs font-medium transition-colors cursor-pointer shrink-0",
          activeCategoryId === "unread"
            ? "bg-[#d9fdd3] text-[#0a1014] font-semibold dark:bg-[#103629] dark:text-[#25d366]"
            : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-white/5 dark:text-[#8696a0] dark:hover:bg-white/10",
        )}
      >
        Unread
      </button>

      {/* Groups */}
      <button
        onClick={() => setActiveCategory("groups")}
        className={clsx(
          "rounded-full px-3 py-1 text-xs font-medium transition-colors cursor-pointer shrink-0",
          activeCategoryId === "groups"
            ? "bg-[#d9fdd3] text-[#0a1014] font-semibold dark:bg-[#103629] dark:text-[#25d366]"
            : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-white/5 dark:text-[#8696a0] dark:hover:bg-white/10",
        )}
      >
        Groups
      </button>

      {/* Custom Categories */}
      {categories.map(cat => {
        const isActive = activeCategoryId === cat.id
        return (
          <div key={cat.id} className="relative flex items-center shrink-0">
            <button
              onClick={() => setActiveCategory(cat.id)}
              onContextMenu={e => handleCategoryContextMenu(e, cat)}
              className={clsx(
                "group flex items-center gap-1.5 rounded-full pl-3 pr-2.5 py-1 text-xs font-medium transition-colors cursor-pointer",
                isActive
                  ? "bg-[#d9fdd3] text-[#0a1014] font-semibold dark:bg-[#103629] dark:text-[#25d366]"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-white/5 dark:text-[#8696a0] dark:hover:bg-white/10",
              )}
              title={`${cat.name} (${cat.chatIds.length} chats) - Right click for options`}
            >
              <span>{cat.name}</span>
              {cat.chatIds.length > 0 && (
                <span
                  className={clsx(
                    "text-[10px] px-1.5 py-0.2 rounded-full",
                    isActive
                      ? "bg-black/10 dark:bg-white/20"
                      : "bg-black/5 dark:bg-white/10",
                  )}
                >
                  {cat.chatIds.length}
                </span>
              )}
              <span
                onClick={e => {
                  e.stopPropagation()
                  handleCategoryContextMenu(e, cat)
                }}
                className="opacity-0 group-hover:opacity-100 text-[10px] p-0.5 hover:bg-black/10 dark:hover:bg-white/20 rounded transition-opacity ml-0.5"
                title="Options"
              >
                ▾
              </span>
            </button>
          </div>
        )
      })}

      {/* Add New Category Button */}
      <button
        onClick={onOpenCreate}
        className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium border border-dashed border-gray-300 dark:border-white/20 text-gray-500 hover:text-gray-800 dark:text-[#8696a0] dark:hover:text-white hover:border-gray-400 dark:hover:border-white/40 shrink-0 transition-colors cursor-pointer"
        title="Create new category"
      >
        <span className="font-bold text-sm leading-none">+</span>
        <span>New</span>
      </button>

      {/* Category context menu popup */}
      {menuCat && (
        <div
          ref={menuRef}
          className="fixed z-50 min-w-36 rounded-xl border border-gray-200 bg-white py-1 shadow-xl dark:border-white/10 dark:bg-[#202c33] animate-in fade-in zoom-in-95 duration-100"
          style={{ top: menuCat.y + 4, left: menuCat.x }}
        >
          <div className="px-3 py-1.5 text-xs font-semibold text-gray-400 dark:text-gray-400 border-b border-gray-100 dark:border-white/5 truncate max-w-44">
            {menuCat.cat.name}
          </div>
          <button
            onClick={() => {
              const target = menuCat.cat
              setMenuCat(null)
              onOpenEdit(target)
            }}
            className="w-full px-3 py-2 text-left text-xs text-gray-800 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-white/5"
          >
            Edit category
          </button>
          <button
            onClick={() => {
              const id = menuCat.cat.id
              setMenuCat(null)
              deleteCategory(id)
            }}
            className="w-full px-3 py-2 text-left text-xs text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
          >
            Delete category
          </button>
        </div>
      )}
    </div>
  )
}
