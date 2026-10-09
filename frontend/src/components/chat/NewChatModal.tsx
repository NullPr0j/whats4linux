import React, { useState, useEffect, useMemo, useRef } from "react"
import { FetchContacts, GetCachedAvatar } from "../../../wailsjs/go/api/Api"
import { api } from "../../../wailsjs/go/models"
import type { ChatItem } from "../../store/types"
import { UserAvatar } from "../../assets/svgs/chat_icons"
import { useSelfAvatarStore } from "../../store/useSelfAvatarStore"
import { getMyUser, isMe } from "../../lib/self"

interface NewChatModalProps {
  isOpen: boolean
  onClose: () => void
  onSelectChat: (chat: ChatItem) => void
}

function ContactRow({
  contact,
  onClick,
}: {
  contact: api.Contact
  onClick: () => void
}) {
  const [avatar, setAvatar] = useState<string>("")

  useEffect(() => {
    let mounted = true
    if (contact.jid) {
      GetCachedAvatar(contact.jid, true)
        .then(url => {
          if (mounted && url) setAvatar(url)
        })
        .catch(() => {})
    }
    return () => {
      mounted = false
    }
  }, [contact.jid])

  const displayName =
    contact.full_name || contact.short || (contact.push_name ? `~ ${contact.push_name}` : "") || contact.phno || contact.jid
  const initials = displayName
    .replace(/[^a-zA-Z0-9 ]/g, "")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase())
    .join("")

  return (
    <div
      onClick={onClick}
      className="flex items-center gap-3.5 px-4 py-3 hover:bg-gray-100 dark:hover:bg-dark-tertiary/60 cursor-pointer transition-colors"
    >
      <div className="w-11 h-11 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden flex items-center justify-center shrink-0">
        {avatar ? (
          <img src={avatar} alt={displayName} className="w-full h-full object-cover" />
        ) : initials ? (
          <span className="font-semibold text-sm text-gray-700 dark:text-gray-200">
            {initials}
          </span>
        ) : (
          <UserAvatar />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className="font-medium text-sm text-gray-900 dark:text-gray-100 truncate">
            {displayName}
          </span>
          {contact.is_business && (
            <span className="text-[10px] uppercase font-bold text-green px-1.5 py-0.5 rounded-sm bg-green/10">
              Business
            </span>
          )}
        </div>
        {contact.phno && contact.phno !== displayName && (
          <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5 font-mono">
            {contact.phno}
          </p>
        )}
      </div>
    </div>
  )
}

export function NewChatModal({ isOpen, onClose, onSelectChat }: NewChatModalProps) {
  const [contacts, setContacts] = useState<api.Contact[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState("")
  const searchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!isOpen) {
      setSearch("")
      return
    }

    setLoading(true)
    FetchContacts()
      .then(list => {
        const sorted = (list || []).sort((a, b) => {
          const nameA = a.full_name || a.short || a.push_name || a.phno || ""
          const nameB = b.full_name || b.short || b.push_name || b.phno || ""
          return nameA.localeCompare(nameB, undefined, { sensitivity: "base" })
        })
        setContacts(sorted)
      })
      .catch(err => {
        console.error("Failed to load contacts for new chat:", err)
      })
      .finally(() => {
        setLoading(false)
      })

    // Focus input on open
    setTimeout(() => {
      searchInputRef.current?.focus()
    }, 50)
  }, [isOpen])

  // ESC key to close
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [isOpen, onClose])

  // Check if search input looks like a phone number to offer direct chat
  const sanitizedDigits = useMemo(() => {
    return search.replace(/[^0-9]/g, "")
  }, [search])

  const isPhoneNumberQuery = sanitizedDigits.length >= 7

  const myUser = getMyUser()
  const selfAvatar = useSelfAvatarStore(s => s.selfAvatar)

  const showSelfChat = useMemo(() => {
    if (!myUser) return false
    const term = search.toLowerCase().trim()
    if (!term) return true
    return "you".includes(term) || "message yourself".includes(term) || myUser.includes(term)
  }, [myUser, search])

  const filteredContacts = useMemo(() => {
    const term = search.toLowerCase().trim()
    const nonSelf = contacts.filter(c => !isMe(c.jid))
    if (!term) return nonSelf
    return nonSelf.filter(c => {
      const name = (c.full_name || c.push_name || c.short || "").toLowerCase()
      const phone = (c.phno || "").toLowerCase()
      const jid = (c.jid || "").toLowerCase()
      return name.includes(term) || phone.includes(term) || jid.includes(term)
    })
  }, [contacts, search])

  const handleSelectContact = (contact: api.Contact) => {
    const name =
      contact.full_name || contact.push_name || contact.short || contact.phno || contact.jid
    const chat: ChatItem = {
      id: contact.jid,
      name,
      subtitle: "",
      type: contact.jid.endsWith("@g.us") ? "group" : "contact",
      time: "",
      unreadCount: 0,
    }
    onSelectChat(chat)
    onClose()
  }

  const handleDirectNumberChat = () => {
    if (!sanitizedDigits) return
    const directJid = `${sanitizedDigits}@s.whatsapp.net`
    const chat: ChatItem = {
      id: directJid,
      name: `+${sanitizedDigits}`,
      subtitle: "",
      type: "contact",
      time: "",
      unreadCount: 0,
    }
    onSelectChat(chat)
    onClose()
  }

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 animate-fadeIn"
      onClick={onClose}
    >
      <div
        className="flex flex-col w-full max-w-md max-h-[80vh] bg-white dark:bg-dark-secondary rounded-2xl shadow-2xl overflow-hidden border border-gray-200 dark:border-gray-800"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">New chat</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-gray-100 dark:hover:bg-dark-tertiary text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 transition-colors cursor-pointer"
            title="Close (Esc)"
          >
            ✕
          </button>
        </div>

        {/* Search Bar */}
        <div className="px-4 py-3 bg-gray-50/50 dark:bg-dark-bg/40 border-b border-gray-100 dark:border-gray-800">
          <div className="relative flex items-center">
            <svg
              className="absolute left-3.5 w-4 h-4 text-gray-400 pointer-events-none"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <input
              ref={searchInputRef}
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search name or phone number..."
              className="w-full pl-10 pr-9 py-2 bg-white dark:bg-dark-tertiary border border-gray-200 dark:border-gray-700/80 rounded-xl text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-green/50"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-3 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 cursor-pointer"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Contacts List / Direct Action */}
        <div className="flex-1 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-800/60">
          {/* Direct Phone Number Prompt if digits typed */}
          {isPhoneNumberQuery && (
            <div
              onClick={handleDirectNumberChat}
              className="flex items-center gap-3.5 px-4 py-3 bg-green/5 hover:bg-green/10 cursor-pointer transition-colors"
            >
              <div className="w-11 h-11 rounded-full bg-green flex items-center justify-center text-white shrink-0 shadow-sm">
                <span className="text-xl leading-none">💬</span>
              </div>
              <div className="flex-1 min-w-0">
                <span className="font-semibold text-sm text-green truncate block">
                  Message +{sanitizedDigits}
                </span>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  Start chat with this phone number
                </span>
              </div>
            </div>
          )}

          {/* Message Yourself option (pinned at top like WhatsApp) */}
          {showSelfChat && (
            <div
              onClick={() => {
                const selfJid = `${myUser}@s.whatsapp.net`
                onSelectChat({
                  id: selfJid,
                  name: "You",
                  subtitle: "Message yourself",
                  type: "contact",
                  time: "",
                  unreadCount: 0,
                  avatar: selfAvatar,
                })
                onClose()
              }}
              className="flex items-center gap-3.5 px-4 py-3 hover:bg-gray-100 dark:hover:bg-dark-tertiary/60 cursor-pointer transition-colors bg-green/5 dark:bg-green/5"
            >
              <div className="w-11 h-11 rounded-full bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 overflow-hidden flex items-center justify-center shrink-0 font-bold">
                {selfAvatar ? (
                  <img src={selfAvatar} alt="You" className="w-full h-full object-cover" />
                ) : (
                  <span>You</span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-sm text-gray-900 dark:text-gray-100">
                    You
                  </span>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    (Message yourself)
                  </span>
                </div>
                <p className="text-xs text-gray-400 dark:text-gray-500 truncate mt-0.5">
                  Send notes, links, or media to yourself
                </p>
              </div>
            </div>
          )}

          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 text-sm text-gray-500">
              <div className="animate-spin rounded-full h-6 w-6 border-2 border-green border-t-transparent mb-2" />
              Loading contacts...
            </div>
          ) : filteredContacts.length === 0 && !isPhoneNumberQuery && !showSelfChat ? (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
              <span className="text-3xl mb-2">🔍</span>
              <p className="font-medium text-sm text-gray-800 dark:text-gray-200">
                No contacts found
              </p>
              <p className="text-xs text-gray-400 mt-1 max-w-xs">
                Type a phone number with country code (e.g. +1234567890) to message anyone directly.
              </p>
            </div>
          ) : (
            filteredContacts.map(contact => (
              <ContactRow
                key={contact.jid}
                contact={contact}
                onClick={() => handleSelectContact(contact)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  )
}
