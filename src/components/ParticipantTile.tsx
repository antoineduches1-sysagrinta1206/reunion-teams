'use client'

import React, { useRef, useEffect, useState } from 'react'
import { MicOff, Mic } from 'lucide-react'

export interface Participant {
  id: string
  name: string
  avatar: string
  isAI: boolean
  isMuted: boolean
  isSpeaking: boolean
  isVideoOn: boolean
  color?: string
}

interface ParticipantTileProps {
  participant: Participant
  photoUrl?: string
  idleVideoUrl?: string       // Looping "listening" video (always plays when not speaking)
  talkingVideoUrl?: string    // Speaking video (plays once with audio when speaking)
  onVideoEnded?: () => void
}

const COLORS = ['#7B83EB', '#E74856', '#00A4EF', '#FFB900', '#9B59B6', '#2ECC71']

export default function ParticipantTile({ participant, photoUrl, idleVideoUrl, talkingVideoUrl, onVideoEnded }: ParticipantTileProps) {
  const { name, isMuted, isSpeaking, color } = participant
  const idleRef = useRef<HTMLVideoElement>(null)
  const talkRef = useRef<HTMLVideoElement>(null)
  const prevTalkUrl = useRef<string | undefined>(undefined)
  const prevIdleUrl = useRef<string | undefined>(undefined)
  const onVideoEndedRef = useRef(onVideoEnded)
  const [isBlinking, setIsBlinking] = useState(false)
  const [talkVisible, setTalkVisible] = useState(false)
  const [frozen, setFrozen] = useState(false)

  // Keep ref in sync without triggering useEffect re-runs
  useEffect(() => { onVideoEndedRef.current = onVideoEnded }, [onVideoEnded])

  const initial = name.charAt(0).toUpperCase()
  const bgColor = color || COLORS[name.charCodeAt(0) % COLORS.length]
  const hasPhoto = !!photoUrl
  const hasIdle = !!idleVideoUrl
  const isTalking = isSpeaking && !!talkingVideoUrl

  // Natural eye blink (only if static photo, no idle video)
  useEffect(() => {
    if (!hasPhoto || hasIdle || isTalking) return
    const blink = () => {
      setIsBlinking(true)
      setTimeout(() => setIsBlinking(false), 150)
    }
    const schedule = () => {
      const delay = 2500 + Math.random() * 4000
      return setTimeout(() => {
        blink()
        timerId = schedule()
      }, delay)
    }
    let timerId = schedule()
    return () => clearTimeout(timerId)
  }, [hasPhoto, hasIdle, isTalking])

  // Idle video: loops silently, always playing when not talking
  useEffect(() => {
    const idle = idleRef.current
    if (!idle || !idleVideoUrl) return

    if (idleVideoUrl !== prevIdleUrl.current) {
      idle.src = idleVideoUrl
      idle.load()
      prevIdleUrl.current = idleVideoUrl
    }
    idle.muted = true
    idle.loop = true
    idle.play().catch(() => {})
  }, [idleVideoUrl])

  // Talking video: plays once with audio when speaking
  // Simulates natural webcam micro-freeze (like Zoom network lag) to mask the transition
  useEffect(() => {
    const talk = talkRef.current
    const idle = idleRef.current
    if (!talk) return

    if (isTalking && talkingVideoUrl) {
      // Step 1: Freeze the idle video — looks like a brief network lag
      if (idle) {
        idle.pause()
        idle.muted = true
      }
      setFrozen(true)

      // Step 2: Pre-load talk video in background while "frozen"
      if (talkingVideoUrl !== prevTalkUrl.current) {
        talk.src = talkingVideoUrl
        talk.load()
        prevTalkUrl.current = talkingVideoUrl
      }
      talk.muted = false
      talk.loop = false
      talk.currentTime = 0

      const startTalk = () => {
        talk.play().then(() => {
          // Step 3: After ~150ms freeze, swap to talk (viewer thinks lag ended)
          setTalkVisible(true)
          setFrozen(false)
        }).catch((e) => console.warn('Talk video play error:', e))
      }

      // Wait for video to be decodable, plus a min freeze duration
      const minFreeze = 120 // ms — feels like a natural Zoom micro-lag
      const freezeStart = Date.now()

      const onReady = () => {
        const elapsed = Date.now() - freezeStart
        const remaining = Math.max(0, minFreeze - elapsed)
        setTimeout(startTalk, remaining)
      }

      if (talk.readyState >= 3) {
        onReady()
      } else {
        talk.oncanplay = () => {
          talk.oncanplay = null
          onReady()
        }
      }

      talk.onended = () => {
        // Step 4: Freeze briefly again, then resume idle
        setTalkVisible(false)
        setFrozen(true)
        setTimeout(() => {
          if (idle) {
            idle.play().catch(() => {})
          }
          setFrozen(false)
          if (onVideoEndedRef.current) onVideoEndedRef.current()
        }, 100)
      }
    } else {
      setTalkVisible(false)
      setFrozen(false)
      talk.pause()
      talk.onended = null
      talk.oncanplay = null
      if (idle && idleVideoUrl) idle.play().catch(() => {})
    }
  }, [isTalking, talkingVideoUrl, idleVideoUrl])

  return (
    <div
      className={`
        relative w-full h-full rounded-[4px] overflow-hidden
        transition-all duration-200
        ${isSpeaking ? 'ring-[3px] ring-[#5b5fc7] z-10' : 'border border-[#3b3b3b]'}
      `}
      style={{ backgroundColor: '#1a1a1a' }}
    >
      {/* Fallback initials — only if no photo and no idle */}
      {!hasPhoto && !hasIdle && (
        <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ backgroundColor: '#2d2d2d' }}>
          <div
            className="rounded-full flex items-center justify-center"
            style={{ backgroundColor: bgColor, width: '25%', maxWidth: 80, aspectRatio: '1' }}
          >
            <span className="text-white font-semibold" style={{ fontSize: 'clamp(16px, 3vw, 32px)' }}>{initial}</span>
          </div>
        </div>
      )}

      {/* Static photo — visible when no idle video and not talking */}
      {hasPhoto && !hasIdle && (
        <div
          className="absolute inset-0"
          style={{ zIndex: 1 }}
        >
          <img
            src={photoUrl}
            alt={name}
            className="w-full h-full object-cover"
          />
          <div
            className="absolute left-0 right-0 pointer-events-none"
            style={{
              top: '22%',
              height: '12%',
              background: 'rgba(0,0,0,0.35)',
              opacity: isBlinking ? 1 : 0,
              transition: isBlinking ? 'opacity 0.06s ease-in' : 'opacity 0.1s ease-out',
              filter: 'blur(6px)',
              zIndex: 2,
            }}
          />
        </div>
      )}

      {/* Idle video — loops silently, visible underneath */}
      {hasIdle && (
        <video
          ref={idleRef}
          playsInline
          muted
          loop
          className="w-full h-full object-cover absolute inset-0"
          style={{ zIndex: 2 }}
        />
      )}

      {/* Talking video — on top when speaking */}
      <video
        ref={talkRef}
        playsInline
        className="w-full h-full object-cover absolute inset-0"
        style={{
          zIndex: 3,
          opacity: talkVisible ? 1 : 0,
          pointerEvents: talkVisible ? 'auto' : 'none',
        }}
      />

      {/* Micro-freeze overlay — simulates webcam bandwidth drop */}
      {frozen && (
        <div
          className="absolute inset-0"
          style={{
            zIndex: 4,
            background: 'rgba(0,0,0,0.06)',
            pointerEvents: 'none',
          }}
        />
      )}

      {/* Speaking indicator bar */}
      {isSpeaking && (
        <div className="absolute top-0 left-0 right-0 h-[3px] z-30">
          <div className="h-full bg-[#5b5fc7] animate-pulse" />
        </div>
      )}

      {/* Name label — bottom left */}
      <div className="absolute bottom-2 left-2 z-20">
        <div className="flex items-center gap-1.5 bg-[#292828]/80 backdrop-blur-sm rounded px-2 py-0.5">
          <div className={`rounded-full p-0.5 ${isMuted ? 'bg-red-600/80' : ''}`}>
            {isMuted ? <MicOff className="w-2.5 h-2.5 text-white" /> : <Mic className="w-2.5 h-2.5 text-white/70" />}
          </div>
          <span className="text-[12px] text-white font-medium">{name}</span>
        </div>
      </div>
    </div>
  )
}
