'use client'

import React, { useEffect, useRef, useState, useCallback } from 'react'

interface HeyGenAvatarProps {
  participantName: string
  avatarId?: string
  onReady?: () => void
  onStartTalking?: () => void
  onStopTalking?: () => void
  className?: string
}

export default function HeyGenAvatar({
  participantName,
  avatarId,
  onReady,
  onStartTalking,
  onStopTalking,
  className = '',
}: HeyGenAvatarProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const avatarRef = useRef<any>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'talking' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const sessionActive = useRef(false)

  // Initialize streaming avatar session
  const initSession = useCallback(async () => {
    if (sessionActive.current) return
    setStatus('loading')
    setError(null)

    try {
      // 1. Get token from our API
      console.log(`[HEYGEN:${participantName}] Getting token...`)
      const tokenRes = await fetch('/api/heygen-token', { method: 'POST' })
      if (!tokenRes.ok) throw new Error(`Token failed: ${tokenRes.status}`)
      const { token } = await tokenRes.json()
      if (!token) throw new Error('No token received')
      console.log(`[HEYGEN:${participantName}] Token obtained`)

      // 2. Import SDK dynamically (client-only)
      const { default: StreamingAvatar, StreamingEvents, AvatarQuality } = await import('@heygen/streaming-avatar')

      // 3. Create streaming avatar instance
      const avatar = new StreamingAvatar({ token })
      avatarRef.current = avatar

      // 4. Set up events
      avatar.on(StreamingEvents.STREAM_READY, (event: any) => {
        console.log(`[HEYGEN:${participantName}] Stream ready!`, event)
        if (avatar.mediaStream && videoRef.current) {
          videoRef.current.srcObject = avatar.mediaStream
          videoRef.current.play().catch(() => {})
        }
        setStatus('ready')
        sessionActive.current = true
        onReady?.()
      })

      avatar.on(StreamingEvents.AVATAR_START_TALKING, () => {
        console.log(`[HEYGEN:${participantName}] Started talking`)
        setStatus('talking')
        onStartTalking?.()
      })

      avatar.on(StreamingEvents.AVATAR_STOP_TALKING, () => {
        console.log(`[HEYGEN:${participantName}] Stopped talking`)
        setStatus('ready')
        onStopTalking?.()
      })

      avatar.on(StreamingEvents.STREAM_DISCONNECTED, () => {
        console.log(`[HEYGEN:${participantName}] Disconnected`)
        setStatus('idle')
        sessionActive.current = false
      })

      // 5. Start avatar session
      console.log(`[HEYGEN:${participantName}] Creating session...`)
      const sessionInfo = await avatar.createStartAvatar({
        quality: AvatarQuality.Medium,
        avatarName: avatarId || 'default',
        language: 'fr',
      })
      console.log(`[HEYGEN:${participantName}] Session:`, sessionInfo.session_id)

    } catch (err: any) {
      console.error(`[HEYGEN:${participantName}] Error:`, err)
      setError(err.message || 'Init failed')
      setStatus('error')
    }
  }, [participantName, avatarId, onReady, onStartTalking, onStopTalking])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (avatarRef.current && sessionActive.current) {
        console.log(`[HEYGEN:${participantName}] Cleaning up session`)
        avatarRef.current.stopAvatar().catch(() => {})
        sessionActive.current = false
      }
    }
  }, [participantName])

  return (
    <div className={`relative w-full h-full ${className}`}>
      {/* Avatar video stream */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        className="w-full h-full object-cover"
      />

      {/* Status overlay */}
      {status === 'idle' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#2d2d2d]">
          <button
            onClick={initSession}
            className="bg-purple-600 hover:bg-purple-700 text-white text-sm px-4 py-2 rounded-md transition-colors"
          >
            Activer Avatar
          </button>
          <span className="text-gray-400 text-xs mt-2">{participantName}</span>
        </div>
      )}

      {status === 'loading' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#2d2d2d]">
          <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-gray-400 text-xs mt-2">Connexion HeyGen...</span>
        </div>
      )}

      {status === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#2d2d2d]">
          <span className="text-red-400 text-xs mb-2">{error}</span>
          <button
            onClick={initSession}
            className="bg-red-600 hover:bg-red-700 text-white text-xs px-3 py-1 rounded transition-colors"
          >
            Réessayer
          </button>
        </div>
      )}

      {/* Talking indicator */}
      {status === 'talking' && (
        <div className="absolute top-2 right-2 z-10 bg-green-500/80 backdrop-blur-sm rounded px-2 py-0.5">
          <span className="text-[10px] text-white font-medium animate-pulse">En train de parler...</span>
        </div>
      )}

      {/* Name label */}
      <div className="absolute bottom-2 left-2 z-10">
        <div className="flex items-center gap-1.5 bg-[#292828]/80 backdrop-blur-sm rounded px-2 py-0.5">
          <span className="text-[12px] text-white font-medium">{participantName}</span>
        </div>
      </div>
    </div>
  )
}

// Expose a way to make the avatar speak from outside
export function useHeyGenControl() {
  const avatarRefs = useRef<Map<string, any>>(new Map())

  const registerAvatar = useCallback((id: string, avatarInstance: any) => {
    avatarRefs.current.set(id, avatarInstance)
  }, [])

  const speak = useCallback(async (id: string, text: string) => {
    const avatar = avatarRefs.current.get(id)
    if (!avatar) {
      console.warn(`[HEYGEN] No avatar found for ${id}`)
      return
    }
    try {
      await avatar.speak({ text, task_type: 'talk' })
    } catch (err) {
      console.error(`[HEYGEN] Speak error for ${id}:`, err)
    }
  }, [])

  const interrupt = useCallback(async (id: string) => {
    const avatar = avatarRefs.current.get(id)
    if (avatar) await avatar.interrupt().catch(() => {})
  }, [])

  return { registerAvatar, speak, interrupt }
}
