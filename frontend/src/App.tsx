import { useEffect, useRef, useState } from "react"
import { Login, GetCustomCSS, GetCustomJS, SetWindowFocused, PlaceCall } from "../wailsjs/go/api/Api"
import { EventsOn, BrowserOpenURL } from "../wailsjs/runtime/runtime"
import QRCode from "qrcode"
import { ChatListScreen } from "./screens/ChatScreen"
import { LoginScreen } from "./screens/LoginScreen"
import { SettingsScreen } from "./screens/SettingsScreen"
import { initSelf } from "./lib/self"
import { Lightbox } from "./components/Lightbox"
import { ForwardModal } from "./components/chat/ForwardModal"
import { ContactProfileModal } from "./components/chat/ContactProfileModal"

import { useUIStore, useChatStore } from "./store"
import { useAppSettingsStore } from "./store/useAppSettingsStore"
import { applyThemeClass } from "./lib/theme"
import { useMuteStore } from "./store/useMuteStore"

type Screen = "login" | "chats" | "settings"

function App() {
  const [screen, setScreen] = useState<Screen>("login")
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const loginStartedRef = useRef(false)
  const [status, setStatus] = useState<string>("waiting")

  const { theme, loaded } = useAppSettingsStore()
  const notifications = useUIStore(s => s.notifications)
  const profileModalJid = useUIStore(s => s.profileModalJid)
  const closeProfileModal = useUIStore(s => s.closeProfileModal)
  const selectChat = useChatStore(s => s.selectChat)

  useEffect(() => {
    useAppSettingsStore.getState().loadSettings()
  }, [])

  useEffect(() => {
    if (loaded) {
      applyThemeClass(theme)
    }
  }, [theme, loaded])

  // Open links inside message text in the system browser instead of navigating
  // the app's webview. Links are rendered as <a class="msg-link"> by the backend.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      const anchor = target?.closest?.("a.msg-link") as HTMLAnchorElement | null
      if (anchor) {
        e.preventDefault()
        const href = anchor.getAttribute("href")
        if (href) BrowserOpenURL(href)
      }
    }
    document.addEventListener("click", onClick)
    return () => document.removeEventListener("click", onClick)
  }, [])

  // Keep the backend informed of window focus so it only notifies when the
  // window is in the background.
  useEffect(() => {
    const updateFocus = () => {
      const isFocused = document.hasFocus() && document.visibilityState === "visible"
      SetWindowFocused(isFocused)
    }
    const onFocus = () => updateFocus()
    const onBlur = () => SetWindowFocused(false)

    window.addEventListener("focus", onFocus)
    window.addEventListener("blur", onBlur)
    window.addEventListener("focusin", onFocus)
    window.addEventListener("focusout", onBlur)
    document.addEventListener("visibilitychange", updateFocus)
    updateFocus()

    return () => {
      window.removeEventListener("focus", onFocus)
      window.removeEventListener("blur", onBlur)
      window.removeEventListener("focusin", onFocus)
      window.removeEventListener("focusout", onBlur)
      document.removeEventListener("visibilitychange", updateFocus)
    }
  }, [])

  useEffect(() => {
    GetCustomCSS().then(css => {
      if (css) {
        const style = document.createElement("style")
        style.id = "custom-css"
        style.innerHTML = css
        document.head.appendChild(style)
      }
    })

    GetCustomJS().then(js => {
      if (js) {
        const script = document.createElement("script")
        script.id = "custom-js"
        script.innerHTML = js
        document.body.appendChild(script)
      }
    })
  }, [])

  useEffect(() => {
    const unsubQR = EventsOn("wa:qr", async (qr: string) => {
      if (!canvasRef.current) return
      await QRCode.toCanvas(canvasRef.current, qr, {
        width: 300,
        color: { dark: "#000000", light: "#ffffff" },
      })
    })

    const unsubStatus = EventsOn("wa:status", (status: string) => {
      setStatus(status)
      if (status === "logged_in" || status === "success") {
        setScreen("chats")
        void initSelf()
      }
    })

    const unsubDownload = EventsOn("download:complete", (fileName: string) => {
      const notificationId = useUIStore.getState().addNotification(`Downloaded: ${fileName}`)
      setTimeout(() => {
        useUIStore.getState().removeNotification(notificationId)
      }, 3000)
    })

    // Keep the muted-chats store fresh so chat rows/info panels stay in sync
    // with mute changes made anywhere (this app, the phone, another device).
    const unsubMuteUpdate = EventsOn(
      "wa:chat_mute_update",
      (data: { chatId: string; muted: boolean }) => {
        if (!data?.chatId) return
        useMuteStore.getState().setMuted(data.chatId, !!data.muted)
      },
    )

    // Register all status listeners before starting login. Existing sessions
    // can complete quickly enough to otherwise lose the "logged_in" event.
    if (!loginStartedRef.current) {
      loginStartedRef.current = true
      void Login().catch(err => setStatus(`error: ${String(err)}`))
    }

    return () => {
      unsubQR()
      unsubStatus()
      unsubDownload()
      unsubMuteUpdate()
    }
  }, [])

  return (
    <div className="min-h-screen bg-light-secondary text-light-text dark:bg-black dark:text-white relative">
      <Lightbox />
      <ForwardModal />
      <ContactProfileModal
        jid={profileModalJid || ""}
        isOpen={!!profileModalJid}
        onClose={closeProfileModal}
        onMessageDirectly={(jid, name, avatar) => {
          selectChat({
            id: jid.split(":")[0],
            name,
            avatar,
          })
          closeProfileModal()
        }}
        onStartCall={jid => {
          PlaceCall(jid.split(":")[0]).catch(console.error)
          closeProfileModal()
        }}
      />
      <div className="fixed bottom-4 right-4 z-[10001] flex flex-col gap-2 pointer-events-none">
        {notifications.map(n => (
          <div
            key={n.id}
            className="pointer-events-auto flex items-center justify-between gap-3 bg-zinc-900/95 text-white text-sm px-4 py-2.5 rounded-xl shadow-xl border border-white/10 animate-in fade-in slide-in-from-bottom-2 duration-200"
          >
            <span>{n.message}</span>
            <button
              onClick={() => removeNotification(n.id)}
              className="text-zinc-400 hover:text-white transition-colors cursor-pointer text-xs p-1 rounded-md"
              title="Dismiss"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      {screen === "login" && <LoginScreen canvasRef={canvasRef} status={status} />}

      {(screen === "chats" || screen === "settings") && (
        <div className={screen === "settings" ? "hidden" : "contents"}>
          <ChatListScreen onOpenSettings={() => setScreen("settings")} />
        </div>
      )}

      {screen === "settings" && <SettingsScreen onBack={() => setScreen("chats")} />}
    </div>
  )
}

export default App
