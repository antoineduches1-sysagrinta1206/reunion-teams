'use client'

import React, { useState, useEffect, useRef } from 'react'
import { Send, Video, Square, Settings, Upload, UserCircle } from 'lucide-react'

interface ParticipantConfig {
  id: string
  name: string
  color: string
  videoFile: string
}

const DEFAULT_PARTICIPANTS: ParticipantConfig[] = [
  { id: 'p1', name: 'Victoria Ashworth', color: '#7B83EB', videoFile: '/videos/VIDEOVRAI-trimmed.mp4' },
  { id: 'p2', name: 'Marcus Chen', color: '#E74856', videoFile: '/videos/IKEA CEO_ Live Teams Meeting Strategy Update_1080p_caption.mp4' },
  { id: 'p3', name: 'Catherine Sinclair', color: '#00A4EF', videoFile: '' },
  { id: 'p4', name: 'Edward Montgomery', color: '#FFB900', videoFile: '' },
  { id: 'p5', name: 'Alexandra Pemberton', color: '#9B59B6', videoFile: '' },
]

// Send command to meeting via API
async function sendCommand(cmd: Record<string, unknown>) {
  try {
    const res = await fetch('/api/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cmd),
    })
    return res.ok
  } catch {
    return false
  }
}

export default function AdminPanel() {
  const [participants, setParticipants] = useState<ParticipantConfig[]>(DEFAULT_PARTICIPANTS)
  const [selectedParticipant, setSelectedParticipant] = useState<string>('p1')
  const [textInput, setTextInput] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [isPreparing, setIsPreparing] = useState(false)
  const [preparedLipsync, setPreparedLipsync] = useState<{ videoUrl: string; text: string; participantId: string } | null>(null)
  const [activeSpeaker, setActiveSpeaker] = useState<string | null>(null)
  const [log, setLog] = useState<string[]>([])
  const logEndRef = useRef<HTMLDivElement>(null)
  const [facePhotos, setFacePhotos] = useState<Record<string, string>>({})
  const [isUploading, setIsUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [deepfaceWebcamImg, setDeepfaceWebcamImg] = useState<string | null>(null)
  const webcamFaceInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [log])

  const addLog = (msg: string) => {
    setLog((prev) => [...prev.slice(-50), `[${new Date().toLocaleTimeString()}] ${msg}`])
  }

  const updateParticipant = (id: string, field: keyof ParticipantConfig, value: string) => {
    setParticipants((prev) => {
      const updated = prev.map((p) => (p.id === id ? { ...p, [field]: value } : p))
      sendCommand({ type: 'updateParticipants', participants: updated })
      return updated
    })
  }

  // MODE 1: Envoi rapide (TTS seul, pas de lip-sync)
  const handleSendQuick = async () => {
    if (!textInput.trim() || isSending) return
    const text = textInput.trim()
    const participant = participants.find((p) => p.id === selectedParticipant)
    if (!participant) return

    setIsSending(true)
    setTextInput('')
    addLog(`🎤 ${participant.name}: "${text}"`)

    const ok = await sendCommand({
      type: 'speak',
      participantId: selectedParticipant,
      text: text,
    })

    if (ok) {
      setActiveSpeaker(selectedParticipant)
      addLog(`✅ Envoyé (TTS rapide)`)
      const dur = Math.max(text.length * 100, 3000)
      setTimeout(() => setActiveSpeaker(null), dur)
    } else {
      addLog(`❌ Erreur envoi`)
    }
    setIsSending(false)
  }

  // MODE 2: Préparer lip-sync (D-ID génère vidéo où la bouche bouge)
  const handlePrepareLipsync = async () => {
    if (!textInput.trim() || isPreparing) return
    const text = textInput.trim()
    const participant = participants.find((p) => p.id === selectedParticipant)
    if (!participant) return

    setIsPreparing(true)
    setPreparedLipsync(null)
    addLog(`🔄 Préparation lip-sync pour ${participant.name}: "${text}"...`)

    try {
      const res = await fetch('/api/lipsync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, participantId: selectedParticipant }),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || `HTTP ${res.status}`)
      }

      const data = await res.json()
      setPreparedLipsync({
        videoUrl: data.videoUrl,
        text,
        participantId: selectedParticipant,
      })
      setTextInput('')
      addLog(`✅ Lip-sync prêt! Clique "Envoyer lip-sync" pour diffuser`)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      addLog(`❌ Lip-sync erreur: ${msg}`)
    } finally {
      setIsPreparing(false)
    }
  }

  // MODE 2b: Envoyer la vidéo lip-syncée préparée
  const handleSendLipsync = async () => {
    if (!preparedLipsync) return
    const participant = participants.find((p) => p.id === preparedLipsync.participantId)

    const ok = await sendCommand({
      type: 'speakLipsync',
      participantId: preparedLipsync.participantId,
      videoUrl: preparedLipsync.videoUrl,
    })

    if (ok) {
      setActiveSpeaker(preparedLipsync.participantId)
      addLog(`🎬 Lip-sync envoyé pour ${participant?.name}`)
      setTimeout(() => setActiveSpeaker(null), 15000)
    }
    setPreparedLipsync(null)
  }

  // DEEPFACE: Upload a custom face photo for a participant
  const handleUploadFace = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setIsUploading(true)
    const participant = participants.find((p) => p.id === selectedParticipant)
    addLog(`🧠 DeepFace: upload visage pour ${participant?.name}...`)

    try {
      const formData = new FormData()
      formData.append('participantId', selectedParticipant)
      formData.append('photo', file)

      const res = await fetch('/api/deepface', {
        method: 'POST',
        body: formData,
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || `HTTP ${res.status}`)
      }

      const data = await res.json()
      setFacePhotos((prev) => ({ ...prev, [selectedParticipant]: data.photoPath }))

      // Tell meeting page to update the photo
      await sendCommand({
        type: 'updatePhoto',
        participantId: selectedParticipant,
        photoPath: data.photoPath,
      })

      addLog(`✅ DeepFace: visage mis à jour pour ${participant?.name}`)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      addLog(`❌ DeepFace erreur: ${msg}`)
    } finally {
      setIsUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  // DEEPFACE WEBCAM: Upload face to swap onto YOUR live webcam
  const handleSetWebcamFace = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    addLog(`🧠 DeepFace Webcam: upload visage...`)

    // Save locally via /api/deepface with special "webcam" participantId
    const formData = new FormData()
    formData.append('participantId', 'webcam')
    formData.append('photo', file)

    try {
      const res = await fetch('/api/deepface', {
        method: 'POST',
        body: formData,
      })
      if (!res.ok) throw new Error(`Upload failed: ${res.status}`)
      const data = await res.json()

      setDeepfaceWebcamImg(data.photoPath)

      // Tell meeting page to enable DeepFace on webcam
      await sendCommand({
        type: 'setDeepface',
        imagePath: data.photoPath,
      })

      addLog(`✅ DeepFace Webcam activé!`)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      addLog(`❌ DeepFace Webcam erreur: ${msg}`)
    }

    if (webcamFaceInputRef.current) webcamFaceInputRef.current.value = ''
  }

  const handleDisableWebcamFace = async () => {
    setDeepfaceWebcamImg(null)
    await sendCommand({ type: 'setDeepface', imagePath: null })
    addLog(`🧠 DeepFace Webcam désactivé`)
  }

  const handleStop = async () => {
    await sendCommand({ type: 'stop' })
    setActiveSpeaker(null)
    addLog('⏹️ Stop')
  }

  const handlePlayVideo = async (id: string) => {
    const p = participants.find((p) => p.id === id)
    if (!p?.videoFile) {
      addLog(`⚠️ Pas de vidéo pour ${p?.name}`)
      return
    }
    const ok = await sendCommand({ type: 'playVideo', participantId: id, videoFile: p.videoFile })
    if (ok) {
      setActiveSpeaker(id)
      addLog(`▶️ Vidéo: ${p.name}`)
    }
  }

  const selected = participants.find((p) => p.id === selectedParticipant)

  return (
    <div className="min-h-screen bg-[#0f0f0f] text-white">
      {/* Header */}
      <div className="bg-[#1a1a2e] border-b border-[#333] px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Settings className="w-5 h-5 text-[#5b5fc7]" />
          <h1 className="text-lg font-bold">Panel Admin — Contrôle Live</h1>
        </div>
        <div className="flex items-center gap-2">
          <div className={`w-2.5 h-2.5 rounded-full ${activeSpeaker ? 'bg-green-500 animate-pulse' : 'bg-gray-500'}`} />
          <span className="text-sm text-gray-400">{activeSpeaker ? `${participants.find(p => p.id === activeSpeaker)?.name} parle...` : 'En attente'}</span>
        </div>
      </div>

      <div className="flex h-[calc(100vh-52px)]">
        {/* Left: Participant tiles */}
        <div className="w-[400px] border-r border-[#333] overflow-y-auto p-4">
          <h2 className="text-sm font-semibold text-gray-400 mb-3 uppercase tracking-wider">Participants</h2>
          <div className="space-y-3">
            {participants.map((p) => (
              <div
                key={p.id}
                onClick={() => setSelectedParticipant(p.id)}
                className={`rounded-lg p-3 cursor-pointer transition-all ${
                  selectedParticipant === p.id
                    ? 'bg-[#5b5fc7]/20 border border-[#5b5fc7]'
                    : 'bg-[#1e1e1e] border border-[#333] hover:border-[#555]'
                } ${activeSpeaker === p.id ? 'ring-2 ring-green-500' : ''}`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0"
                    style={{ backgroundColor: p.color }}
                  >
                    {p.name.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <input
                      type="text"
                      value={p.name}
                      onChange={(e) => updateParticipant(p.id, 'name', e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      className="bg-transparent text-white text-sm font-medium w-full outline-none border-b border-transparent focus:border-[#5b5fc7] pb-0.5"
                    />
                    <div className="text-xs text-gray-500 mt-0.5 truncate">
                      {p.videoFile ? p.videoFile.split('/').pop() : 'Pas de vidéo'}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={(e) => { e.stopPropagation(); handlePlayVideo(p.id) }}
                      className="p-1.5 rounded hover:bg-white/10"
                      title="Lancer vidéo"
                    >
                      <Video className="w-4 h-4 text-gray-400" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* DeepFace — upload custom face */}
          <div className="mt-4 p-3 bg-[#1e1e1e] rounded-lg border border-purple-500/30">
            <div className="flex items-center gap-2 mb-3">
              <UserCircle className="w-4 h-4 text-purple-400" />
              <h3 className="text-xs font-semibold text-purple-400 uppercase">DeepFace — {selected?.name}</h3>
            </div>
            <p className="text-[11px] text-gray-500 mb-3">Change le visage de ce participant. La photo sera utilisée pour l&apos;affichage ET le lip-sync.</p>

            {facePhotos[selectedParticipant] && (
              <div className="mb-3 flex items-center gap-2">
                <img
                  src={facePhotos[selectedParticipant]}
                  alt="face"
                  className="w-12 h-12 rounded-full object-cover border-2 border-purple-500"
                />
                <span className="text-xs text-green-400">Visage actif</span>
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleUploadFace}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="w-full bg-purple-600 hover:bg-purple-700 disabled:opacity-40 text-white rounded-lg px-4 py-2.5 flex items-center justify-center gap-2 transition-colors text-sm font-medium"
            >
              <Upload className="w-4 h-4" />
              {isUploading ? 'Upload en cours...' : 'Visage participant'}
            </button>
          </div>

          {/* DeepFace WEBCAM — swap YOUR face in real-time */}
          <div className="mt-4 p-3 bg-[#1e1e1e] rounded-lg border border-pink-500/30">
            <div className="flex items-center gap-2 mb-3">
              <Video className="w-4 h-4 text-pink-400" />
              <h3 className="text-xs font-semibold text-pink-400 uppercase">DeepFace Webcam</h3>
            </div>
            <p className="text-[11px] text-gray-500 mb-3">Remplace VOTRE visage en live par la photo choisie. Les autres voient le visage DeepFace.</p>

            {deepfaceWebcamImg && (
              <div className="mb-3 flex items-center gap-2">
                <img src={deepfaceWebcamImg} alt="deepface" className="w-12 h-12 rounded-full object-cover border-2 border-pink-500" />
                <span className="text-xs text-pink-400">Actif sur votre webcam</span>
              </div>
            )}

            <input
              ref={webcamFaceInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleSetWebcamFace}
              className="hidden"
            />
            <div className="flex gap-2">
              <button
                onClick={() => webcamFaceInputRef.current?.click()}
                className="flex-1 bg-pink-600 hover:bg-pink-700 text-white rounded-lg px-3 py-2 flex items-center justify-center gap-2 transition-colors text-sm font-medium"
              >
                <Upload className="w-3.5 h-3.5" />
                Choisir visage
              </button>
              {deepfaceWebcamImg && (
                <button
                  onClick={handleDisableWebcamFace}
                  className="bg-gray-600 hover:bg-gray-700 text-white rounded-lg px-3 py-2 text-sm font-medium transition-colors"
                >
                  OFF
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Center: Main control */}
        <div className="flex-1 flex flex-col">
          {/* Text to speech control */}
          <div className="p-6 border-b border-[#333]">
            <div className="flex items-center gap-3 mb-3">
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-xs"
                style={{ backgroundColor: selected?.color }}
              >
                {selected?.name.charAt(0)}
              </div>
              <span className="text-sm font-medium">{selected?.name}</span>
              <span className="text-xs text-gray-500">dit :</span>
            </div>
            <div className="flex gap-2">
              <textarea
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    handleSendQuick()
                  }
                }}
                placeholder="Écris ce que l'IA doit dire... (Entrée pour envoyer)"
                className="flex-1 bg-[#1e1e1e] text-white text-sm rounded-lg px-4 py-3 outline-none border border-[#333] focus:border-[#5b5fc7] resize-none"
                rows={3}
                disabled={isSending || isPreparing}
              />
              <div className="flex flex-col gap-2">
                <button
                  onClick={handleSendQuick}
                  disabled={isSending || !textInput.trim()}
                  className="bg-[#5b5fc7] hover:bg-[#4a4eb5] disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg px-4 py-2 flex items-center justify-center gap-2 transition-colors"
                >
                  <Send className="w-4 h-4" />
                  <span className="text-sm font-medium">{isSending ? 'Envoi...' : 'Rapide'}</span>
                </button>
                <button
                  onClick={handlePrepareLipsync}
                  disabled={isPreparing || !textInput.trim()}
                  className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg px-4 py-2 flex items-center justify-center gap-2 transition-colors"
                >
                  <span className="text-sm font-medium">{isPreparing ? 'Generation...' : 'Lip-sync'}</span>
                </button>
                <button
                  onClick={handleStop}
                  className="bg-red-600 hover:bg-red-700 text-white rounded-lg px-4 py-2 flex items-center justify-center gap-2 transition-colors"
                >
                  <Square className="w-3 h-3" />
                  <span className="text-sm">Stop</span>
                </button>
              </div>
            </div>

            {/* Lip-sync ready banner */}
            {preparedLipsync && (
              <div className="mx-6 mb-4 p-3 bg-emerald-900/40 border border-emerald-500/50 rounded-lg flex items-center justify-between">
                <div>
                  <span className="text-emerald-400 text-sm font-medium">Lip-sync pret !</span>
                  <span className="text-gray-400 text-xs ml-2">"{preparedLipsync.text.slice(0, 40)}..."</span>
                </div>
                <button
                  onClick={handleSendLipsync}
                  className="bg-emerald-500 hover:bg-emerald-600 text-black font-bold rounded-lg px-6 py-2 text-sm transition-colors"
                >
                  ENVOYER LIP-SYNC
                </button>
              </div>
            )}

            {isPreparing && (
              <div className="mx-6 mb-4 p-3 bg-yellow-900/30 border border-yellow-500/30 rounded-lg">
                <div className="flex items-center gap-3">
                  <div className="w-4 h-4 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin" />
                  <span className="text-yellow-400 text-sm">D-ID genere la video lip-sync (~20s)...</span>
                </div>
              </div>
            )}
          </div>

          {/* Quick actions */}
          <div className="p-4 border-b border-[#333] flex flex-wrap gap-2">
            <span className="text-xs text-gray-500 self-center mr-2">Actions rapides :</span>
            {participants.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  setSelectedParticipant(p.id)
                  handlePlayVideo(p.id)
                }}
                disabled={!p.videoFile}
                className="text-xs bg-[#1e1e1e] hover:bg-[#2a2a2a] disabled:opacity-30 border border-[#333] rounded-full px-3 py-1.5 flex items-center gap-1.5 transition-colors"
              >
                <div className="w-4 h-4 rounded-full" style={{ backgroundColor: p.color }} />
                ▶ {p.name.split(' ')[0]}
              </button>
            ))}
          </div>

          {/* Log */}
          <div className="flex-1 overflow-y-auto p-4">
            <h2 className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wider">Journal d&apos;activité</h2>
            <div className="space-y-1 font-mono text-xs">
              {log.map((entry, i) => (
                <div key={i} className="text-gray-400 py-0.5">{entry}</div>
              ))}
              <div ref={logEndRef} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
