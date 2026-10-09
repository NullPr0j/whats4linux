import { useEffect } from "react"
import { OpenDocument, OpenDocumentInBrowser, DownloadFile } from "../../../wailsjs/go/api/Api"

interface PdfPreviewPaneProps {
  pdf: {
    src: string
    title: string
    messageId: string
  }
  onClose: () => void
}

export function PdfPreviewPane({ pdf, onClose }: PdfPreviewPaneProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  return (
    <div className="w-full h-full flex flex-col bg-white dark:bg-[#111b21] overflow-hidden select-none">
      {/* Top action bar: only icon buttons */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-[#202c33] shrink-0">
        <div className="flex items-center gap-2 min-w-0 pr-4">
          <span className="text-lg shrink-0">📄</span>
          <span className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate" title={pdf.title}>
            {pdf.title}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => void OpenDocument(pdf.messageId)}
            className="p-2 rounded-lg text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-white/10 transition-colors"
            title="Open in system viewer"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </button>
          <button
            onClick={() => void OpenDocumentInBrowser(pdf.messageId)}
            className="p-2 rounded-lg text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-white/10 transition-colors"
            title="Open in browser"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="2" y1="12" x2="22" y2="12" />
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
          </button>
          <button
            onClick={() => void DownloadFile(pdf.messageId)}
            className="p-2 rounded-lg text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-white/10 transition-colors"
            title="Download file"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
              <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
            </svg>
          </button>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-white/10 transition-colors"
            title="Close preview (Esc)"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>
      {/* PDF View Frame */}
      <div className="flex-1 w-full bg-white relative">
        <iframe
          src={pdf.src}
          className="w-full h-full border-0 bg-white"
          title={pdf.title}
        />
      </div>
    </div>
  )
}
