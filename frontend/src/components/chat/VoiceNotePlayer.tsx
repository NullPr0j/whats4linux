import React, { useState, useRef, useEffect, useMemo, useCallback } from "react"
import clsx from "clsx"

export function formatAudioTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return "0:00"
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s < 10 ? "0" : ""}${s}`
}

export function getNextPlaybackRate(current: number): number {
  if (current === 1.0) return 1.5
  if (current === 1.5) return 2.0
  return 1.0
}

export function generateWaveform(seed: string, count = 32): number[] {
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i)
    hash |= 0
  }

  const bars: number[] = []
  for (let i = 0; i < count; i++) {
    // Deterministic pseudo-random value based on position and hash
    const x = Math.sin((i + 1) * 12.9898 + hash) * 43758.5453
    const rand = x - Math.floor(x)
    // Bell-shaped curve in the middle with natural speech envelope variation
    const envelope = Math.sin((Math.PI * (i + 1)) / (count + 1))
    const rawHeight = 0.2 + (0.5 * envelope) + (0.3 * rand)
    bars.push(Math.max(0.15, Math.min(1.0, Math.round(rawHeight * 100) / 100)))
  }
  return bars
}

interface VoiceNotePlayerProps {
  src: string
  messageId: string
  isFromMe?: boolean
}

export function VoiceNotePlayer({ src, messageId, isFromMe }: VoiceNotePlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const waveformRef = useRef<HTMLDivElement | null>(null)
  const isDraggingRef = useRef(false)

  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [playbackRate, setPlaybackRate] = useState(1.0)

  const bars = useMemo(() => generateWaveform(messageId, 32), [messageId])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const handleLoadedMetadata = () => {
      if (audio.duration && !isNaN(audio.duration) && isFinite(audio.duration)) {
        setDuration(audio.duration)
      }
    }
    const handleTimeUpdate = () => {
      if (!isDraggingRef.current) {
        setCurrentTime(audio.currentTime)
      }
    }
    const handlePlay = () => setIsPlaying(true)
    const handlePause = () => setIsPlaying(false)
    const handleEnded = () => {
      setIsPlaying(false)
      setCurrentTime(0)
    }

    audio.addEventListener("loadedmetadata", handleLoadedMetadata)
    audio.addEventListener("timeupdate", handleTimeUpdate)
    audio.addEventListener("play", handlePlay)
    audio.addEventListener("pause", handlePause)
    audio.addEventListener("ended", handleEnded)

    return () => {
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata)
      audio.removeEventListener("timeupdate", handleTimeUpdate)
      audio.removeEventListener("play", handlePlay)
      audio.removeEventListener("pause", handlePause)
      audio.removeEventListener("ended", handleEnded)
    }
  }, [src])

  const togglePlay = () => {
    const audio = audioRef.current
    if (!audio) return
    if (isPlaying) {
      audio.pause()
    } else {
      void audio.play().catch(err => console.error("Audio playback error:", err))
    }
  }

  const cycleSpeed = (e: React.MouseEvent) => {
    e.stopPropagation()
    const nextRate = getNextPlaybackRate(playbackRate)
    setPlaybackRate(nextRate)
    if (audioRef.current) {
      audioRef.current.playbackRate = nextRate
    }
  }

  const handleSeek = useCallback((clientX: number) => {
    if (!waveformRef.current || !audioRef.current) return
    const rect = waveformRef.current.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    const totalDuration = audioRef.current.duration || duration || 0
    const newTime = ratio * totalDuration
    setCurrentTime(newTime)
    audioRef.current.currentTime = newTime
  }, [duration])

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    isDraggingRef.current = true
    handleSeek(e.clientX)

    const onMouseMove = (ev: MouseEvent) => {
      if (isDraggingRef.current) {
        handleSeek(ev.clientX)
      }
    }
    const onMouseUp = () => {
      isDraggingRef.current = false
      window.removeEventListener("mousemove", onMouseMove)
      window.removeEventListener("mouseup", onMouseUp)
    }
    window.addEventListener("mousemove", onMouseMove)
    window.addEventListener("mouseup", onMouseUp)
  }

  const progressRatio = duration > 0 ? Math.min(1, currentTime / duration) : 0
  const activeBarCount = Math.floor(progressRatio * bars.length)

  return (
    <div className="flex flex-col gap-1.5 py-1 px-1.5 min-w-[260px] max-w-[320px] select-none">
      <audio ref={audioRef} src={src} preload="metadata" />

      {/* Main player controls row */}
      <div className="flex items-center gap-3">
        {/* Play/Pause Button */}
        <button
          onClick={togglePlay}
          className="w-10 h-10 rounded-full bg-[#00a884] hover:bg-[#02906f] active:bg-[#007e63] text-white flex items-center justify-center shrink-0 shadow-sm transition-transform active:scale-95 cursor-pointer"
          title={isPlaying ? "Pause voice note" : "Play voice note"}
        >
          {isPlaying ? (
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
              <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" className="ml-0.5">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>

        {/* Ripple Waveform Container */}
        <div
          ref={waveformRef}
          onMouseDown={handleMouseDown}
          className="flex-1 flex items-center gap-[2.5px] h-9 cursor-pointer relative py-1"
          title="Click or drag to scrub"
        >
          {bars.map((heightMultiplier, idx) => {
            const isPlayed = idx <= activeBarCount
            const isCurrentRipple = isPlaying && Math.abs(idx - activeBarCount) <= 2

            return (
              <span
                key={idx}
                style={{
                  height: `${Math.round(heightMultiplier * 28)}px`,
                }}
                className={clsx(
                  "flex-1 min-w-[2px] max-w-[4px] rounded-full transition-all duration-75",
                  isPlayed
                    ? "bg-[#00a884] dark:bg-[#00a884]"
                    : isFromMe
                    ? "bg-black/25 dark:bg-white/35"
                    : "bg-gray-300 dark:bg-white/30",
                  isCurrentRipple && "scale-y-125 opacity-90",
                )}
              />
            )
          })}

          {/* Scrubber Head Pin */}
          <div
            style={{ left: `${progressRatio * 100}%` }}
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-[#00a884] shadow-sm pointer-events-none transition-transform"
          />
        </div>
      </div>

      {/* Timing and Speed Badge Row */}
      <div className="flex items-center justify-between text-[11px] text-gray-500 dark:text-[#8696a0] px-1 font-mono">
        <span>{formatAudioTime(currentTime > 0 ? currentTime : duration)}</span>

        <div className="flex items-center gap-2">
          {/* WhatsApp Microphone Badge */}
          <span className="text-[#00a884] opacity-80" title="Voice message">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor">
              <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5zm6 6c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-2.08c3.39-.49 6-3.39 6-6.92h-2z" />
            </svg>
          </span>

          {/* Speed Toggle Pill */}
          <button
            onClick={cycleSpeed}
            className="px-2 py-0.5 rounded-full bg-black/5 hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/15 text-[10px] font-semibold text-gray-700 dark:text-[#e9edef] transition-colors cursor-pointer"
            title="Toggle playback speed (1x, 1.5x, 2x)"
          >
            {playbackRate}x
          </button>
        </div>
      </div>
    </div>
  )
}
