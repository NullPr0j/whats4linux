import { useEffect, useState, useRef } from "react"
import clsx from "clsx"
import { useUIStore } from "../store"

// Full-screen media viewer for images and videos.
export function Lightbox() {
  const src = useUIStore(s => s.lightboxSrc)
  const kind = useUIStore(s => s.lightboxKind)
  const close = useUIStore(s => s.closeLightbox)
  const [zoomed, setZoomed] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)

  // Capture-phase ESC so the chat's own ESC handler (which closes the
  // active chat) never sees the event.
  useEffect(() => {
    if (!src) return
    setZoomed(false)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => {})
          return
        }
        e.stopPropagation()
        close()
      }
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [src, close])

  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(!!document.fullscreenElement)
    }
    document.addEventListener("fullscreenchange", onFsChange)
    return () => document.removeEventListener("fullscreenchange", onFsChange)
  }, [])

  const toggleFullscreen = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!document.fullscreenElement) {
      if (videoRef.current?.requestFullscreen) {
        videoRef.current.requestFullscreen().catch(() => {})
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {})
      }
    }
  }

  if (!src) return null

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center overflow-auto bg-black/90 cursor-pointer select-none"
      onClick={close}
    >
      {/* Top right actions */}
      <div className="absolute right-4 top-3 flex items-center gap-3 z-20">
        {kind === "video" && (
          <button
            onClick={toggleFullscreen}
            title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
            className="p-2 rounded-full bg-black/50 hover:bg-black/80 text-white/80 hover:text-white transition-colors cursor-pointer"
          >
            {isFullscreen ? (
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
              </svg>
            )}
          </button>
        )}
        <button
          onClick={close}
          title="Close (Esc)"
          className="text-3xl leading-none text-white/80 hover:text-white cursor-pointer px-1.5"
        >
          ×
        </button>
      </div>

      {kind === "video" ? (
        <video
          ref={videoRef}
          src={src}
          controls
          autoPlay
          playsInline
          onClick={e => e.stopPropagation()}
          className="max-h-[92vh] max-w-[92vw] object-contain cursor-default rounded-lg shadow-2xl"
        />
      ) : (
        <img
          src={src}
          alt=""
          onClick={e => {
            e.stopPropagation()
            setZoomed(z => !z)
          }}
          className={clsx(
            "select-none transition-transform",
            zoomed
              ? "max-h-none max-w-none scale-150 cursor-zoom-out"
              : "max-h-[92vh] max-w-[92vw] cursor-zoom-in object-contain",
          )}
        />
      )}
    </div>
  )
}


