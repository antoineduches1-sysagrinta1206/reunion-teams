'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import TeamsSidebar from '../components/TeamsSidebar'
import MeetingToolbar from '../components/MeetingToolbar'
import ParticipantTile, { Participant } from '../components/ParticipantTile'
import { Search, MoreHorizontal, X } from 'lucide-react'

const DEFAULT_PARTICIPANTS: Participant[] = [
  { id: 'p1', name: 'Victoria Ashworth',    avatar: '', isAI: true, isMuted: true, isSpeaking: false, isVideoOn: false, color: '#7B83EB' },
  { id: 'p2', name: 'Marcus Chen',          avatar: '', isAI: true, isMuted: true, isSpeaking: false, isVideoOn: false, color: '#E74856' },
  { id: 'p3', name: 'Catherine Sinclair',   avatar: '', isAI: true, isMuted: true, isSpeaking: false, isVideoOn: false, color: '#00A4EF' },
  { id: 'p4', name: 'Edward Montgomery',    avatar: '', isAI: true, isMuted: true, isSpeaking: false, isVideoOn: false, color: '#FFB900' },
  { id: 'p5', name: 'Alexandra Pemberton',  avatar: '', isAI: true, isMuted: true, isSpeaking: false, isVideoOn: false, color: '#9B59B6' },
]

export default function MeetingPage() {
  const [isMuted, setIsMuted] = useState(false)
  const [isVideoOff, setIsVideoOff] = useState(false)
  const [showChat, setShowChat] = useState(false)
  const [showParticipants, setShowParticipants] = useState(false)
  const [participants, setParticipants] = useState<Participant[]>(DEFAULT_PARTICIPANTS)
  const [elapsed, setElapsed] = useState(0)
  const [showNotification, setShowNotification] = useState(true)
  const [meetingStarted, setMeetingStarted] = useState(false)
  const [activeVideo, setActiveVideo] = useState<{ participantId: string; url: string; isLipsync?: boolean } | null>(null)
  const [deepfaceImage, setDeepfaceImage] = useState<string | null>(null)
  const [debugLog, setDebugLog] = useState<string[]>(['[INIT] Page loaded'])
  const [sttStatus, setSttStatus] = useState('off')
  const [channelStatus, setChannelStatus] = useState('off')

  const dbg = (msg: string) => {
    console.log('[DBG]', msg)
    setDebugLog((prev) => [...prev.slice(-15), `[${new Date().toLocaleTimeString()}] ${msg}`])
  }

  // Live webcam ref
  const liveVideoRef = useRef<HTMLVideoElement>(null)
  const faceswapCanvasRef = useRef<HTMLCanvasElement>(null)
  const faceswapActiveRef = useRef(false)
  const faceswapInputRef = useRef<HTMLInputElement>(null)
  const [faceswapResult, setFaceswapResult] = useState<string | null>(null)
  const [faceswapStatus, setFaceswapStatus] = useState<string>('')
  const [faceswapSourceB64, setFaceswapSourceB64] = useState<string | null>(null)

  // Handle face swap source upload from tile
  const handleFaceswapUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const b64 = reader.result as string
      setFaceswapSourceB64(b64)
      setDeepfaceImage(b64) // triggers the swap loop
      dbg(`[FACESWAP] Source uploaded: ${(file.size / 1024).toFixed(0)} KB`)
    }
    reader.readAsDataURL(file)
  }, [])

  // ===== REAL FACE SWAP ENGINE (Replicate API) =====
  // Triggered by deepfaceImage (from admin) OR faceswapSourceB64 (from tile upload)
  const faceswapSourceRef = useRef<string | null>(null)

  useEffect(() => {
    faceswapActiveRef.current = false
    setFaceswapResult(null)
    setFaceswapStatus('')

    // Source can come from direct upload (b64) or admin panel (URL)
    const sourceInput = faceswapSourceB64 || deepfaceImage
    if (!sourceInput) {
      console.log('[FACESWAP] OFF — no source')
      return
    }

    console.log('[FACESWAP] Activating...')

    // If source is already base64, use directly. If URL, convert.
    if (sourceInput.startsWith('data:')) {
      faceswapSourceRef.current = sourceInput
      faceswapActiveRef.current = true
      setFaceswapStatus('Démarrage...')
      runSwapLoop()
    } else {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        const c = document.createElement('canvas')
        c.width = img.width; c.height = img.height
        const ctx = c.getContext('2d')
        if (ctx) { ctx.drawImage(img, 0, 0); faceswapSourceRef.current = c.toDataURL('image/jpeg', 0.9) }
        faceswapActiveRef.current = true
        setFaceswapStatus('Démarrage...')
        runSwapLoop()
      }
      img.onerror = () => setFaceswapStatus('Erreur image source')
      img.src = sourceInput
    }

    async function captureFrame(): Promise<string | null> {
      const v = liveVideoRef.current
      const c = faceswapCanvasRef.current
      if (!v || !c || v.readyState < 2) return null
      c.width = v.videoWidth; c.height = v.videoHeight
      const ctx = c.getContext('2d')
      if (!ctx) return null
      ctx.drawImage(v, 0, 0)
      return c.toDataURL('image/jpeg', 0.85)
    }

    async function runSwapLoop() {
      let count = 0
      while (faceswapActiveRef.current) {
        try {
          const src = faceswapSourceRef.current
          if (!src) { await new Promise(r => setTimeout(r, 1000)); continue }
          const frame = await captureFrame()
          if (!frame) { await new Promise(r => setTimeout(r, 1000)); continue }

          setFaceswapStatus(`Swap #${count + 1}...`)
          console.log(`[FACESWAP] Swap #${count + 1} sending...`)

          const res = await fetch('/api/faceswap', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source_url: src, target_url: frame }),
          })
          const data = await res.json()

          if (res.ok && data.success) {
            const output = Array.isArray(data.output) ? data.output[0] : data.output
            console.log(`[FACESWAP] Got output:`, typeof output, String(output).slice(0, 100))
            // Add cache buster to proxy URLs
            const finalUrl = output.startsWith('/api/') ? `${output}&t=${Date.now()}` : output
            setFaceswapResult(finalUrl)
            count++
            setFaceswapStatus(`Swap #${count} OK`)
            console.log(`[FACESWAP] Swap #${count} done! URL set.`)
          } else {
            console.error('[FACESWAP] Error:', data.error)
            setFaceswapStatus(`Err: ${data.error?.slice(0, 30)}`)
          }
        } catch (err: any) {
          console.error('[FACESWAP] Loop error:', err)
          setFaceswapStatus(`Err: ${err.message?.slice(0, 30)}`)
        }
        await new Promise(r => setTimeout(r, 3000))
      }
    }

    return () => { faceswapActiveRef.current = false }
  }, [deepfaceImage, faceswapSourceB64])

  // DOM audio element for TTS playback
  const audioElRef = useRef<HTMLAudioElement>(null)
  // Current audio playing
  const currentAudioRef = useRef<HTMLAudioElement | null>(null)

  // Timer
  useEffect(() => {
    if (!meetingStarted) return
    const timer = setInterval(() => setElapsed((e) => e + 1), 1000)
    return () => clearInterval(timer)
  }, [meetingStarted])

  // Start webcam when meeting starts
  useEffect(() => {
    if (!meetingStarted) return
    navigator.mediaDevices
      .getUserMedia({ video: true, audio: false })
      .then((stream) => {
        if (liveVideoRef.current) liveVideoRef.current.srcObject = stream
      })
      .catch(() => console.log('No webcam available'))
    return () => {
      if (liveVideoRef.current?.srcObject) {
        (liveVideoRef.current.srcObject as MediaStream).getTracks().forEach((t) => t.stop())
      }
    }
  }, [meetingStarted])


  // Participant roles for GPT-4
  const participantRolesRef = useRef<Record<string, string>>({
    p1: 'CEO of the company, professional and decisive',
    p2: 'Chief Financial Officer, analytical and detail-oriented',
    p3: 'Head of Legal, careful and thorough',
    p4: 'Director of Operations, practical and action-oriented',
    p5: 'VP of Marketing, creative and persuasive',
  })
  // Video files for each participant (legacy pre-recorded)
  const videoFilesRef = useRef<Record<string, string>>({
    p1: '/videos/VIDEOVRAI-trimmed.mp4',
    p2: '/videos/IKEA CEO_ Live Teams Meeting Strategy Update_1080p_caption.mp4',
  })
  // Static photos for participants (only used when idle video is assigned)
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({})
  // Idle "listening" videos — loop silently when participant is not speaking
  const [idleVideoUrls, setIdleVideoUrls] = useState<Record<string, string>>({})
  // Conversation history for GPT-4
  const chatHistoryRef = useRef<{ role: string; content: string }[]>([])
  // Is AI currently speaking
  const aiSpeakingRef = useRef(false)

  // Helper: make a participant speak with TTS
  const speakAs = useCallback(async (pid: string, text: string) => {
    if (aiSpeakingRef.current) {
      dbg(`BLOCKED: AI already speaking — force reset`)
      // Safety: force reset after 15s stuck
      aiSpeakingRef.current = false
    }
    aiSpeakingRef.current = true
    dbg(`speakAs(${pid}, "${text.slice(0, 40)}...")`)

    // Stop current audio
    if (currentAudioRef.current) {
      currentAudioRef.current.pause()
      currentAudioRef.current = null
    }

    // Activate speaker
    const vf = videoFilesRef.current[pid]
    dbg(`Video for ${pid}: ${vf || 'NONE'}`)
    if (vf) setActiveVideo({ participantId: pid, url: vf })
    setParticipants((prev) =>
      prev.map((p) =>
        p.id === pid
          ? { ...p, isSpeaking: true, isMuted: false }
          : { ...p, isSpeaking: false, isMuted: true }
      )
    )

    try {
      dbg('Calling /api/tts...')
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, participantId: pid }),
      })
      dbg(`TTS response: ${res.status}`)
      if (!res.ok) throw new Error(`TTS failed: ${res.status}`)

      const blob = await res.blob()
      dbg(`TTS audio blob: ${blob.size} bytes`)
      const url = URL.createObjectURL(blob)

      // Pause speech recognition while TTS plays
      try { (recognitionRef.current as { stop: () => void })?.stop() } catch { /* ok */ }

      // Use DOM audio element (more reliable than new Audio())
      const el = audioElRef.current
      if (el) {
        el.src = url
        el.volume = 1
        currentAudioRef.current = el

        await new Promise<void>((resolve) => {
          el.onended = () => { dbg('AUDIO ENDED'); resolve() }
          el.onerror = () => { dbg('AUDIO ERROR'); resolve() }
          el.play()
            .then(() => dbg('>>> AUDIO PLAYING <<<'))
            .catch((e) => { dbg(`!!! AUDIO BLOCKED: ${e.message}`); resolve() })
        })
      } else {
        dbg('!!! NO AUDIO ELEMENT - refresh page !!!')
      }

      // Restart speech recognition
      try { (recognitionRef.current as { start: () => void })?.start() } catch { /* ok */ }
    } catch (e) {
      dbg(`TTS ERROR: ${e}`)
    }

    // Stop speaking
    setParticipants((prev) => prev.map((p) => ({ ...p, isSpeaking: false, isMuted: true })))
    setActiveVideo(null)
    currentAudioRef.current = null
    aiSpeakingRef.current = false
    dbg('Speaker stopped')
  }, [])

  // Helper: get GPT-4 response and speak
  const aiRespond = useCallback(async (humanText: string) => {
    dbg(`AI responding to: "${humanText.slice(0, 40)}..."`)
    chatHistoryRef.current.push({ role: 'user', content: `[Human in the meeting says]: ${humanText}` })

    const ids = ['p1', 'p2', 'p3', 'p4', 'p5']
    const pid = ids[Math.floor(Math.random() * ids.length)]
    const pName = DEFAULT_PARTICIPANTS.find((p) => p.id === pid)?.name || 'Participant'
    const pRole = participantRolesRef.current[pid] || 'meeting participant'

    try {
      dbg(`Calling GPT-4 as ${pName}...`)
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: chatHistoryRef.current.slice(-10),
          participantName: pName,
          participantRole: pRole,
        }),
      })
      dbg(`GPT-4 response: ${res.status}`)
      if (!res.ok) throw new Error(`Chat API failed: ${res.status}`)
      const data = await res.json()
      const reply = data.reply
      dbg(`GPT-4 reply: "${reply?.slice(0, 50)}..."`)

      if (reply) {
        chatHistoryRef.current.push({ role: 'assistant', content: `[${pName}]: ${reply}` })
        await speakAs(pid, reply)
      }
    } catch (e) {
      dbg(`AI respond ERROR: ${e}`)
    }
  }, [speakAs])

  // Speech recognition: listen to human and make AI respond
  const recognitionRef = useRef<ReturnType<typeof Object> | null>(null)

  useEffect(() => {
    if (!meetingStarted) return

    const SpeechRecognition = (window as unknown as Record<string, unknown>).SpeechRecognition || (window as unknown as Record<string, unknown>).webkitSpeechRecognition
    if (!SpeechRecognition) {
      console.warn('Speech Recognition not supported in this browser')
      return
    }

    const recognition = new (SpeechRecognition as new () => {
      continuous: boolean; interimResults: boolean; lang: string;
      start: () => void; stop: () => void;
      onresult: ((e: { results: { [key: number]: { [key: number]: { transcript: string }; isFinal: boolean } }; resultIndex: number }) => void) | null;
      onend: (() => void) | null;
      onerror: ((e: { error: string }) => void) | null;
    })()
    recognition.continuous = true
    recognition.interimResults = false
    recognition.lang = 'fr-FR'

    recognition.onresult = (event) => {
      const last = event.results[Object.keys(event.results).length - 1]
      if (last?.isFinal) {
        const transcript = last[0]?.transcript?.trim()
        dbg(`STT heard: "${transcript}"`)
        if (transcript && transcript.length > 2 && !aiSpeakingRef.current) {
          setTimeout(() => aiRespond(transcript), 1500 + Math.random() * 1000)
        }
      }
    }

    recognition.onend = () => {
      // Restart if still in meeting
      if (!aiSpeakingRef.current) {
        try { recognition.start() } catch { /* already started */ }
      }
    }

    recognition.onerror = (e) => {
      console.warn('Speech recognition error:', e.error)
      if (e.error !== 'no-speech') {
        setTimeout(() => {
          try { recognition.start() } catch { /* ignore */ }
        }, 1000)
      }
    }

    try {
      recognition.start()
      dbg('STT started (fr-FR)')
      setSttStatus('listening')
    } catch (e) {
      dbg(`STT start error: ${e}`)
      setSttStatus('error')
    }
    recognitionRef.current = recognition

    return () => {
      try { recognition.stop() } catch { /* ignore */ }
    }
  }, [meetingStarted, aiRespond])

  // Poll admin commands from /api/command every 500ms — starts IMMEDIATELY
  useEffect(() => {
    let cancelled = false
    setChannelStatus('polling')
    dbg('Command polling started (always on)')

    const poll = async () => {
      while (!cancelled) {
        try {
          const res = await fetch('/api/command')
          if (res.ok) {
            const data = await res.json()
            const cmds = data.commands || []
            for (const msg of cmds) {
              dbg(`CMD: ${msg.type}`)

              if (msg.type === 'speak') {
                await speakAs(msg.participantId, msg.text)
              }

              if (msg.type === 'playVideo') {
                if (currentAudioRef.current) {
                  currentAudioRef.current.pause()
                  currentAudioRef.current = null
                }
                setActiveVideo({ participantId: msg.participantId, url: msg.videoFile })
                setParticipants((prev) =>
                  prev.map((p) =>
                    p.id === msg.participantId
                      ? { ...p, isSpeaking: true, isMuted: false }
                      : { ...p, isSpeaking: false, isMuted: true }
                  )
                )
              }

              if (msg.type === 'speakLipsync') {
                // D-ID lip-synced video: play video WITH its own audio (lip-sync matches)
                const pid = msg.participantId
                const vidUrl = msg.videoUrl
                dbg(`LIPSYNC video for ${pid}: ${vidUrl?.slice(0, 50)}...`)

                if (currentAudioRef.current) {
                  currentAudioRef.current.pause()
                  currentAudioRef.current = null
                }
                aiSpeakingRef.current = true

                // Set the lip-synced video as activeVideo (with audio enabled)
                setActiveVideo({ participantId: pid, url: vidUrl, isLipsync: true })
                setParticipants((prev) =>
                  prev.map((p) =>
                    p.id === pid
                      ? { ...p, isSpeaking: true, isMuted: false }
                      : { ...p, isSpeaking: false, isMuted: true }
                  )
                )
              }

              if (msg.type === 'stop') {
                if (currentAudioRef.current) {
                  currentAudioRef.current.pause()
                  currentAudioRef.current = null
                }
                setParticipants((prev) => prev.map((p) => ({ ...p, isSpeaking: false, isMuted: true })))
                setActiveVideo(null)
                aiSpeakingRef.current = false
              }

              if (msg.type === 'updatePhoto') {
                // DeepFace: update a participant's face photo in real-time
                const pid = msg.participantId as string
                const newPath = msg.photoPath as string
                dbg(`DEEPFACE: ${pid} → ${newPath}`)
                setPhotoUrls((prev) => ({ ...prev, [pid]: newPath }))
              }

              if (msg.type === 'setDeepface') {
                // DeepFace: set face swap image for YOUR webcam
                const imgPath = msg.imagePath as string | null
                dbg(`DEEPFACE WEBCAM: ${imgPath || 'OFF'}`)
                setDeepfaceImage(imgPath)
              }

              if (msg.type === 'assignVideo') {
                const pid = msg.participantId as string
                const vidFile = msg.videoFile as string
                dbg(`ASSIGN VIDEO: ${pid} → ${vidFile}`)
                videoFilesRef.current[pid] = vidFile
              }

              if (msg.type === 'assignIdleVideo') {
                const pid = msg.participantId as string
                const vidFile = msg.videoFile as string
                dbg(`ASSIGN IDLE: ${pid} → ${vidFile}`)
                setIdleVideoUrls((prev) => ({ ...prev, [pid]: vidFile }))
              }

              if (msg.type === 'playScenario') {
                const seqs = msg.sequence as { participantId: string; videoFile: string }[]
                const idles = msg.idleVideos as Record<string, string> | undefined
                dbg(`SCENARIO: ${seqs?.length} segments, ${idles ? Object.keys(idles).length : 0} idle videos`)

                // Step 1: Set ALL idle videos so every participant is alive
                if (idles) {
                  setIdleVideoUrls((prev) => ({ ...prev, ...idles }))
                }

                // Step 2: Turn on video for ALL participants (they all show idle)
                setParticipants((prev) =>
                  prev.map((p) => ({ ...p, isVideoOn: true, isMuted: true, isSpeaking: false }))
                )

                if (seqs && seqs.length > 0) {
                  ;(async () => {
                    // Small delay to let idle videos load
                    await new Promise(r => setTimeout(r, 2000))

                    for (const seg of seqs) {
                      dbg(`SCENARIO PLAY: ${seg.participantId} → ${seg.videoFile}`)
                      if (currentAudioRef.current) { currentAudioRef.current.pause(); currentAudioRef.current = null }

                      // Set speaking participant — others keep their idle running
                      setActiveVideo({ participantId: seg.participantId, url: seg.videoFile, isLipsync: true })
                      setParticipants((prev) =>
                        prev.map((p) => p.id === seg.participantId
                          ? { ...p, isSpeaking: true, isMuted: false }
                          : { ...p, isSpeaking: false, isMuted: true }
                        )
                      )
                      aiSpeakingRef.current = true

                      // Wait for talking video to end (onVideoEnded sets aiSpeakingRef = false)
                      await new Promise<void>(resolve => {
                        const check = setInterval(() => {
                          if (!aiSpeakingRef.current) { clearInterval(check); resolve() }
                        }, 500)
                        setTimeout(() => { clearInterval(check); resolve() }, 120000)
                      })

                      // Back to idle for speaker, pause before next segment
                      setActiveVideo(null)
                      setParticipants((prev) => prev.map((p) => ({ ...p, isSpeaking: false, isMuted: true })))
                      await new Promise(r => setTimeout(r, 1500))
                    }

                    dbg('SCENARIO DONE')
                    setActiveVideo(null)
                    aiSpeakingRef.current = false
                  })()
                }
              }

              if (msg.type === 'updateParticipants') {
                const configs = msg.participants as { id: string; name: string; color: string; videoFile: string }[]
                setParticipants((prev) =>
                  prev.map((p) => {
                    const cfg = configs.find((c: { id: string }) => c.id === p.id)
                    if (!cfg) return p
                    return { ...p, name: cfg.name, color: cfg.color }
                  })
                )
                configs.forEach((c: { id: string; videoFile: string }) => {
                  if (c.videoFile) videoFilesRef.current[c.id] = c.videoFile
                })
              }
            }
            if (cmds.length > 0) setChannelStatus('active')
          }
        } catch (e) {
          dbg(`Poll error: ${e}`)
        }
        await new Promise((r) => setTimeout(r, 500))
      }
    }

    poll()
    return () => { cancelled = true }
  }, [speakAs])

  // Join meeting — also unlock audio context
  const handleJoinMeeting = useCallback(() => {
    // Play a silent sound to unlock Chrome's autoplay policy
    const el = audioElRef.current
    if (el) {
      el.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA='
      el.play().then(() => {
        dbg('Audio context UNLOCKED')
      }).catch(() => {
        dbg('Audio unlock failed')
      })
    }
    setMeetingStarted(true)
    dbg('Meeting joined')
  }, [])

  // Get photo URL for a participant
  const getPhotoUrl = (pid: string): string | undefined => {
    return photoUrls[pid]
  }
  // Get idle video URL (looping listening animation)
  const getIdleVideoUrl = (pid: string): string | undefined => {
    return idleVideoUrls[pid]
  }
  // Get talking video URL (lip-sync, only when actively speaking)
  const getTalkingVideoUrl = (pid: string): string | undefined => {
    if (!activeVideo || activeVideo.participantId !== pid || !activeVideo.isLipsync) return undefined
    return activeVideo.url
  }

  // --- JOIN SCREEN ---
  if (!meetingStarted) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#1a1a2e]">
        <audio ref={audioElRef} />
        <div className="flex flex-col items-center gap-6">
          <svg viewBox="0 0 24 24" className="w-16 h-16" fill="none">
            <path d="M20.5 6h-3.5V4.5A1.5 1.5 0 0015.5 3h-7A1.5 1.5 0 007 4.5V6H3.5A1.5 1.5 0 002 7.5v9A1.5 1.5 0 003.5 18H7v1.5A1.5 1.5 0 008.5 21h7a1.5 1.5 0 001.5-1.5V18h3.5a1.5 1.5 0 001.5-1.5v-9A1.5 1.5 0 0020.5 6z" fill="#5b5fc7"/>
            <path d="M9.5 8h5v2h-2v5h-1v-5h-2V8z" fill="white"/>
          </svg>
          <h1 className="text-2xl font-semibold text-white">Board of Directors — Q4 Strategy Review</h1>
          <p className="text-gray-400 text-sm">Ready to join?</p>
          <button
            onClick={handleJoinMeeting}
            className="bg-teams-purple hover:bg-teams-purple-dark text-white font-semibold px-8 py-3 rounded-md text-[15px] transition-colors"
          >
            Join now
          </button>
        </div>
      </div>
    )
  }

  // Test: directly trigger TTS for debugging
  const handleTestAudio = async () => {
    dbg('TEST: triggering speakAs p1...')
    await speakAs('p1', 'Hello, this is a test. Can you hear me?')
  }

  // --- MEETING VIEW ---
  return (
    <div className="h-screen flex flex-col bg-[#201f1f]">
      {/* Hidden audio element for TTS playback */}
      <audio ref={audioElRef} />
      {/* Top bar */}
      <div className="h-[48px] bg-[#292828] flex items-center px-3 border-b border-[#383838]">
        <div className="w-[68px] flex items-center justify-center">
          <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none">
            <path d="M20.5 6h-3.5V4.5A1.5 1.5 0 0015.5 3h-7A1.5 1.5 0 007 4.5V6H3.5A1.5 1.5 0 002 7.5v9A1.5 1.5 0 003.5 18H7v1.5A1.5 1.5 0 008.5 21h7a1.5 1.5 0 001.5-1.5V18h3.5a1.5 1.5 0 001.5-1.5v-9A1.5 1.5 0 0020.5 6z" fill="#5b5fc7"/>
            <path d="M9.5 8h5v2h-2v5h-1v-5h-2V8z" fill="white"/>
          </svg>
        </div>
        <div className="flex-1 flex justify-center">
          <div className="relative w-full max-w-[580px]">
            <div className="flex items-center bg-[#201f1f] rounded-md px-3 py-1.5 border border-[#383838]">
              <Search className="w-4 h-4 text-gray-500 mr-2" />
              <span className="text-[13px] text-gray-500">Rechercher</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <MoreHorizontal className="w-5 h-5 text-gray-500 cursor-pointer" />
          <div className="w-8 h-8 rounded-full bg-teams-purple flex items-center justify-center text-white text-xs font-semibold">V</div>
        </div>
      </div>

      {/* Notification bar */}
      {showNotification && (
        <div className="h-[36px] bg-[#2d2c2c] flex items-center justify-between px-4 border-b border-[#383838]">
          <span className="text-[13px] text-gray-400">Restez informé. Activez les notifications de bureau.</span>
          <div className="flex items-center gap-3">
            <button className="text-[13px] text-[#5b5fc7] hover:underline font-medium">Activer</button>
            <button onClick={() => setShowNotification(false)}><X className="w-4 h-4 text-gray-500" /></button>
          </div>
        </div>
      )}

      {/* Main layout */}
      <div className="flex-1 flex overflow-hidden">
        <TeamsSidebar />

        <div className="flex-1 flex flex-col">
          <MeetingToolbar
            isMuted={isMuted}
            isVideoOff={isVideoOff}
            onToggleMute={() => setIsMuted(!isMuted)}
            onToggleVideo={() => setIsVideoOff(!isVideoOff)}
            onToggleChat={() => { setShowChat(!showChat); setShowParticipants(false) }}
            onToggleParticipants={() => { setShowParticipants(!showParticipants); setShowChat(false) }}
            participantCount={participants.length + 1}
            elapsed={elapsed}
          />


          {/* Meeting content — 3x2 Gallery grid (like real Zoom/Teams) */}
          <div className="flex-1 flex overflow-hidden">
            <div className="flex-1 bg-[#201f1f] flex items-center justify-center p-2">
              <div className="grid grid-cols-3 grid-rows-2 gap-1 h-full w-full">
                {/* 5 participants (video when speaking, initials when not) */}
                {participants.map((p) => (
                  <div key={p.id} className="min-w-0 min-h-0">
                    <ParticipantTile
                      participant={p}
                      photoUrl={getPhotoUrl(p.id)}
                      idleVideoUrl={getIdleVideoUrl(p.id)}
                      talkingVideoUrl={getTalkingVideoUrl(p.id)}
                      onVideoEnded={() => {
                        setParticipants((prev) => prev.map((pt) => ({ ...pt, isSpeaking: false, isMuted: true })))
                        setActiveVideo(null)
                        aiSpeakingRef.current = false
                      }}
                    />
                  </div>
                ))}
                {/* 6th tile: LIVE webcam + Face Swap overlay */}
                <div
                  className="min-w-0 min-h-0 relative rounded-[4px] overflow-hidden border border-[#3b3b3b]"
                  style={{
                    background: faceswapResult
                      ? `url(${faceswapResult}) center/cover no-repeat`
                      : '#2d2d2d',
                  }}
                >
                  {/* Raw webcam — always visible underneath, hidden when swap result shown */}
                  <video
                    ref={liveVideoRef}
                    autoPlay
                    playsInline
                    muted
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      transform: 'scaleX(-1)',
                      position: 'absolute',
                      top: 0, left: 0,
                      opacity: faceswapResult ? 0 : 1,
                    }}
                  />
                  {/* Hidden canvas for frame capture */}
                  <canvas ref={faceswapCanvasRef} style={{ display: 'none' }} />
                  {/* Hidden file input for face swap source */}
                  <input ref={faceswapInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFaceswapUpload} />
                  {/* Upload button — visible when no swap active */}
                  {!faceswapSourceB64 && !deepfaceImage && (
                    <button
                      onClick={() => faceswapInputRef.current?.click()}
                      style={{
                        position: 'absolute', top: 8, right: 8, zIndex: 30,
                        background: '#7c3aed', color: 'white', border: 'none',
                        padding: '4px 8px', borderRadius: 4, fontSize: 10,
                        cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
                      }}
                    >
                      🎭 FaceSwap
                    </button>
                  )}
                  {/* Face swap status badge when active */}
                  {(deepfaceImage || faceswapSourceB64) && (
                    <div style={{
                      position: 'absolute', top: 8, right: 8, zIndex: 30,
                      background: 'rgba(124,58,237,0.8)', backdropFilter: 'blur(4px)',
                      borderRadius: 4, padding: '2px 8px', display: 'flex', alignItems: 'center', gap: 4,
                    }}>
                      <div style={{
                        width: 6, height: 6, borderRadius: '50%',
                        background: faceswapResult ? '#4ade80' : '#facc15',
                        animation: 'pulse 1.5s infinite',
                      }} />
                      <span style={{ fontSize: 10, color: 'white', fontWeight: 500 }}>{faceswapStatus || 'FaceSwap...'}</span>
                    </div>
                  )}
                  {/* Stop swap button */}
                  {(deepfaceImage || faceswapSourceB64) && (
                    <button
                      onClick={() => { faceswapActiveRef.current = false; setFaceswapSourceB64(null); setDeepfaceImage(null); setFaceswapResult(null); setFaceswapStatus('') }}
                      style={{
                        position: 'absolute', top: 8, left: 8, zIndex: 30,
                        background: 'rgba(220,38,38,0.8)', color: 'white', border: 'none',
                        padding: '2px 8px', borderRadius: 4, fontSize: 10, cursor: 'pointer',
                      }}
                    >
                      X Stop
                    </button>
                  )}
                  {/* Debug: show result state */}
                  {(deepfaceImage || faceswapSourceB64) && (
                    <div style={{
                      position: 'absolute', bottom: 22, right: 4, zIndex: 30,
                      background: 'rgba(0,0,0,0.7)', color: faceswapResult ? '#4ade80' : '#facc15',
                      padding: '1px 6px', borderRadius: 3, fontSize: 9, fontFamily: 'monospace',
                    }}>
                      {faceswapResult ? `IMG OK (${faceswapResult.length} chars)` : 'Waiting...'}
                    </div>
                  )}
                  <div style={{ position: 'absolute', bottom: 8, left: 8, zIndex: 30 }}>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      background: 'rgba(41,40,40,0.8)', backdropFilter: 'blur(4px)',
                      borderRadius: 4, padding: '2px 8px',
                    }}>
                      <svg style={{ width: 10, height: 10, color: 'rgba(255,255,255,0.7)' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
                      <span style={{ fontSize: 12, color: 'white', fontWeight: 500 }}>Vous</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>


            {/* Side panel */}
            {(showChat || showParticipants) && (
              <div className="w-[320px] bg-[#2d2c2c] border-l border-[#383838] flex flex-col">
                <div className="flex items-center justify-between px-4 py-3 border-b border-[#383838]">
                  <h3 className="text-[14px] font-semibold text-white">
                    {showParticipants ? `Participants (${participants.length})` : 'Conversation'}
                  </h3>
                  <button onClick={() => { setShowChat(false); setShowParticipants(false) }} className="hover:bg-[#3a3a3a] p-1 rounded">
                    <X className="w-4 h-4 text-gray-400" />
                  </button>
                </div>
                {showParticipants && (
                  <div className="flex-1 overflow-y-auto p-2">
                    {participants.map((p) => (
                      <div key={p.id} className="flex items-center gap-3 py-2 px-3 rounded-md hover:bg-[#3a3a3a]">
                        <div className="w-8 h-8 rounded-full bg-teams-purple flex items-center justify-center text-sm font-semibold text-white flex-shrink-0">
                          {p.avatar ? <img src={p.avatar} alt={p.name} className="w-full h-full rounded-full object-cover" /> : p.name.charAt(0)}
                        </div>
                        <span className="text-[13px] text-gray-300">{p.name}</span>
                      </div>
                    ))}
                  </div>
                )}
                {showChat && (
                  <div className="flex-1 flex flex-col">
                    <div className="flex-1 overflow-y-auto p-3">
                      <div className="text-center text-gray-500 text-[13px] mt-10">Aucun message</div>
                    </div>
                    <div className="p-3 border-t border-[#383838]">
                      <input type="text" placeholder="Saisissez un message..." className="w-full bg-[#201f1f] text-gray-300 text-[13px] rounded-md px-3 py-2 outline-none border border-[#383838] focus:border-[#5b5fc7] placeholder-gray-600" />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
