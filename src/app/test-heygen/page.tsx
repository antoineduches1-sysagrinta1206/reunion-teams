'use client'

import React, { useRef, useState, useCallback } from 'react'

export default function TestHeyGen() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const sessionRef = useRef<any>(null)
  const [status, setStatus] = useState('Prêt — clique "Démarrer Avatar"')
  const [logs, setLogs] = useState<string[]>([])
  const [sessionActive, setSessionActive] = useState(false)
  const [textInput, setTextInput] = useState('Bonjour, je suis ravi de participer à cette réunion. Comment allez-vous aujourd\'hui ?')
  const [isSpeaking, setIsSpeaking] = useState(false)

  const addLog = (msg: string) => {
    const t = new Date().toLocaleTimeString()
    setLogs(prev => [...prev.slice(-20), `[${t}] ${msg}`])
  }

  const startAvatar = useCallback(async () => {
    try {
      setStatus('Obtention du token LiveAvatar...')
      addLog('Requesting token from /api/heygen-token...')

      // 1. Get session token from our API
      const tokenRes = await fetch('/api/heygen-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: 'fr', quality: 'medium' }),
      })

      const tokenData = await tokenRes.json()
      addLog(`Token response: ${JSON.stringify(tokenData).slice(0, 150)}`)

      if (!tokenRes.ok || !tokenData.token) {
        throw new Error(`Token failed: ${tokenData.error || tokenRes.status}`)
      }
      setStatus('Token obtenu! Import du SDK...')

      // 2. Import LiveAvatar SDK
      const { LiveAvatarSession, SessionEvent, AgentEventsEnum } = await import('@heygen/liveavatar-web-sdk')
      addLog('SDK imported')
      setStatus('SDK chargé! Démarrage de la session...')

      // 3. Create session with token
      const session = new LiveAvatarSession(tokenData.token)
      sessionRef.current = session

      // 4. Events
      session.on(SessionEvent.SESSION_STATE_CHANGED, (state: any) => {
        addLog(`State: ${state}`)
        setStatus(`État: ${state}`)
      })

      session.on(SessionEvent.SESSION_STREAM_READY, () => {
        addLog('STREAM READY!')
        setStatus('✅ Stream prêt! Avatar connecté.')
        if (videoRef.current) {
          session.attach(videoRef.current)
          videoRef.current.play().catch(() => {})
        }
        setSessionActive(true)
      })

      session.on(SessionEvent.SESSION_DISCONNECTED, (reason: any) => {
        addLog(`Disconnected: ${reason}`)
        setStatus(`❌ Déconnecté: ${reason}`)
        setSessionActive(false)
      })

      session.on(AgentEventsEnum.AVATAR_SPEAK_STARTED, () => {
        addLog('Avatar started speaking')
        setIsSpeaking(true)
        setStatus('🗣️ Avatar parle...')
      })

      session.on(AgentEventsEnum.AVATAR_SPEAK_ENDED, () => {
        addLog('Avatar stopped speaking')
        setIsSpeaking(false)
        setStatus('✅ Avatar prêt')
      })

      session.on(AgentEventsEnum.AVATAR_TRANSCRIPTION, (e: any) => {
        addLog(`Avatar said: "${e.text}"`)
      })

      // 5. Start the session
      addLog('Starting session...')
      await session.start()
      addLog('Session started!')

    } catch (err: any) {
      setStatus(`❌ Erreur: ${err.message}`)
      addLog(`ERROR: ${err.message}`)
      console.error('[TEST-HEYGEN]', err)
    }
  }, [])

  const handleSpeak = useCallback(async () => {
    if (!sessionRef.current || !textInput.trim()) return
    try {
      addLog(`Sending: "${textInput.trim().slice(0, 50)}..."`)
      sessionRef.current.repeat(textInput.trim())
      setStatus('Texte envoyé...')
    } catch (err: any) {
      addLog(`Speak error: ${err.message}`)
      setStatus(`❌ Speak error: ${err.message}`)
    }
  }, [textInput])

  const handleStop = useCallback(async () => {
    if (!sessionRef.current) return
    try {
      await sessionRef.current.stop()
      setSessionActive(false)
      setStatus('Session terminée')
      addLog('Session stopped')
      sessionRef.current = null
    } catch (err: any) {
      addLog(`Stop error: ${err.message}`)
    }
  }, [])

  const handleInterrupt = useCallback(async () => {
    if (!sessionRef.current) return
    sessionRef.current.interrupt()
    setIsSpeaking(false)
    setStatus('✅ Interrompu')
    addLog('Interrupted')
  }, [])

  return (
    <div style={{ background: '#111', color: 'white', minHeight: '100vh', padding: 20 }}>
      <h1 style={{ fontSize: 24, marginBottom: 10 }}>🎭 TEST LiveAvatar (HeyGen)</h1>

      {/* Status */}
      <p style={{
        background: '#222',
        padding: 12,
        borderRadius: 8,
        marginBottom: 15,
        fontFamily: 'monospace',
        fontSize: 14,
        border: `2px solid ${sessionActive ? '#22c55e' : isSpeaking ? '#a855f7' : '#555'}`,
      }}>
        {status}
      </p>

      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        {/* Video */}
        <div>
          <h3 style={{ marginBottom: 5 }}>📹 Avatar Stream</h3>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            style={{
              width: 500,
              height: 375,
              background: '#222',
              border: `3px solid ${isSpeaking ? '#a855f7' : sessionActive ? '#22c55e' : '#555'}`,
              borderRadius: 8,
            }}
          />
        </div>

        {/* Controls */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 300 }}>
          <h3 style={{ marginBottom: 5 }}>🎛️ Contrôles</h3>

          {!sessionActive ? (
            <button
              onClick={startAvatar}
              style={{
                background: '#7c3aed',
                color: 'white',
                border: 'none',
                padding: '12px 24px',
                borderRadius: 8,
                cursor: 'pointer',
                fontSize: 16,
                fontWeight: 'bold',
              }}
            >
              🚀 Démarrer Avatar
            </button>
          ) : (
            <>
              <textarea
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                rows={4}
                style={{
                  background: '#222',
                  color: 'white',
                  border: '1px solid #555',
                  borderRadius: 8,
                  padding: 10,
                  fontSize: 14,
                  resize: 'vertical',
                }}
              />
              <button
                onClick={handleSpeak}
                disabled={isSpeaking}
                style={{
                  background: isSpeaking ? '#555' : '#22c55e',
                  color: 'white',
                  border: 'none',
                  padding: '10px 20px',
                  borderRadius: 8,
                  cursor: isSpeaking ? 'not-allowed' : 'pointer',
                  fontSize: 14,
                  fontWeight: 'bold',
                }}
              >
                🗣️ Faire parler
              </button>
              <button
                onClick={handleInterrupt}
                style={{
                  background: '#f59e0b',
                  color: 'white',
                  border: 'none',
                  padding: '10px 20px',
                  borderRadius: 8,
                  cursor: 'pointer',
                  fontSize: 14,
                }}
              >
                ✋ Interrompre
              </button>
              <button
                onClick={handleStop}
                style={{
                  background: '#ef4444',
                  color: 'white',
                  border: 'none',
                  padding: '10px 20px',
                  borderRadius: 8,
                  cursor: 'pointer',
                  fontSize: 14,
                }}
              >
                ⏹️ Arrêter session
              </button>
            </>
          )}
        </div>
      </div>

      {/* Logs */}
      <div style={{ marginTop: 20 }}>
        <h3 style={{ marginBottom: 5 }}>📋 Logs</h3>
        <div style={{
          background: '#1a1a1a',
          border: '1px solid #333',
          borderRadius: 8,
          padding: 10,
          maxHeight: 200,
          overflow: 'auto',
          fontFamily: 'monospace',
          fontSize: 12,
        }}>
          {logs.map((l, i) => (
            <div key={i} style={{ color: l.includes('ERROR') ? '#ef4444' : l.includes('READY') ? '#22c55e' : '#aaa' }}>
              {l}
            </div>
          ))}
          {logs.length === 0 && <div style={{ color: '#555' }}>En attente...</div>}
        </div>
      </div>
    </div>
  )
}
