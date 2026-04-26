'use client'

import React, { useState, useEffect, useRef, useCallback, Suspense } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import MeetingToolbar from '../../../components/MeetingToolbar'
import { Mic, MicOff, MoreHorizontal, X, Eye, LogIn, Users } from 'lucide-react'

interface MeetingParticipant {
  id: string
  name: string
  color: string
  videoUrl: string
}

interface TimelineSegment {
  participantId: string
  startTime: number
  endTime: number
}

interface MeetingState {
  started: boolean
  startedAt: number | null
  clientJoined: boolean
  adminJoined: boolean
}

interface MeetingData {
  id: string
  title: string
  participants: MeetingParticipant[]
  timeline: TimelineSegment[]
  totalDuration: number
  state: MeetingState
}

function MeetingRoomInner() {
  const params = useParams()
  const searchParams = useSearchParams()
  const meetingId = params.id as string
  const role = searchParams.get('role')
  const adminKey = searchParams.get('key') || ''
  const isAdmin = role === 'admin' && !!adminKey

  const [meetingData, setMeetingData] = useState<MeetingData | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [joined, setJoined] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [isMuted, setIsMuted] = useState(true)
  const [isVideoOff, setIsVideoOff] = useState(false)
  const [showChat, setShowChat] = useState(false)
  const [showParticipants, setShowParticipants] = useState(false)
  const [speakingId, setSpeakingId] = useState<string | null>(null)
  const [scenarioStatus, setScenarioStatus] = useState('')
  const [meetingState, setMeetingState] = useState<MeetingState>({ started: false, startedAt: null, clientJoined: false, adminJoined: false })
  const [displayName, setDisplayName] = useState(isAdmin ? 'Admin' : 'Client')
  const prevClientJoinedRef = useRef(false) // kept for future use
  const [videoLoading, setVideoLoading] = useState<Record<string, boolean>>({})
  const [audioBlocked, setAudioBlocked] = useState(false)
  const [meetingEnded, setMeetingEnded] = useState(false)
  const meetingEndedRef = useRef(false)

  // Preload: download videos fully into memory (blob URLs) before playback
  const [videoBlobUrls, setVideoBlobUrls] = useState<Record<string, string>>({})
  const [preloadProgress, setPreloadProgress] = useState(0) // 0-100
  const [preloadDone, setPreloadDone] = useState(false)

  const audioElRef = useRef<HTMLAudioElement>(null)
  const liveVideoRef = useRef<HTMLVideoElement>(null)
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({})
  const playStartRef = useRef<number>(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // WebRTC state for live admin <-> client communication
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)
  const peerRef = useRef<RTCPeerConnection | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null)

  // Fetch meeting data
  useEffect(() => {
    if (!meetingId) return
    const keyParam = isAdmin ? `&key=${adminKey}` : ''
    fetch(`/api/meeting?id=${meetingId}${keyParam}`)
      .then(r => r.json())
      .then(data => {
        if (data.success && data.meeting) {
          setMeetingData(data.meeting)
          if (data.meeting.state) setMeetingState(data.meeting.state)
        } else {
          setLoadError(data.error || 'Reunion introuvable')
        }
        setLoading(false)
      })
      .catch(() => {
        setLoadError('Erreur de connexion')
        setLoading(false)
      })
  }, [meetingId, isAdmin, adminKey])

  // Preload ALL videos into memory as blob URLs — zero network dependency during playback
  useEffect(() => {
    if (!meetingData || preloadDone) return
    let cancelled = false

    const preloadAll = async () => {
      const participants = meetingData.participants
      const total = participants.length
      if (total === 0) { setPreloadDone(true); setPreloadProgress(100); return }

      const blobMap: Record<string, string> = {}
      let loaded = 0

      await Promise.all(participants.map(async (p) => {
        try {
          console.log(`[PRELOAD] Downloading ${p.name}: ${p.videoUrl}`)
          const res = await fetch(p.videoUrl)
          if (!res.ok) throw new Error(`HTTP ${res.status}`)

          // Track download progress via ReadableStream
          const contentLength = Number(res.headers.get('content-length') || 0)
          const reader = res.body?.getReader()
          if (!reader) throw new Error('No reader')

          const chunks: BlobPart[] = []
          let received = 0
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            chunks.push(value)
            received += value.length
            // Update per-video progress estimate
            if (contentLength > 0 && !cancelled) {
              const videoProgress = (received / contentLength) * 100
              const overallProgress = ((loaded * 100) + videoProgress) / total
              setPreloadProgress(Math.min(99, Math.round(overallProgress)))
            }
          }

          if (cancelled) return
          const blob = new Blob(chunks, { type: 'video/mp4' })
          const url = URL.createObjectURL(blob)
          blobMap[p.id] = url
          loaded++
          setPreloadProgress(Math.round((loaded / total) * 100))
          console.log(`[PRELOAD] ${p.name}: done (${(received / 1024 / 1024).toFixed(1)}MB) — ${loaded}/${total}`)
        } catch (err: any) {
          console.error(`[PRELOAD] ${p.name}: failed — ${err.message}, using remote URL`)
          loaded++
          setPreloadProgress(Math.round((loaded / total) * 100))
        }
      }))

      if (!cancelled) {
        setVideoBlobUrls(blobMap)
        setPreloadDone(true)
        setPreloadProgress(100)
        console.log(`[PRELOAD] All done: ${Object.keys(blobMap).length}/${total} cached in memory`)
      }
    }

    preloadAll()
    return () => { cancelled = true }
  }, [meetingData, preloadDone])

  // Cleanup blob URLs on unmount
  useEffect(() => {
    return () => {
      Object.values(videoBlobUrls).forEach(url => {
        try { URL.revokeObjectURL(url) } catch {}
      })
    }
  }, [videoBlobUrls])

  // Poll meeting state every 2s (for admin to see when client joins, and vice versa)
  useEffect(() => {
    if (!meetingData) return
    const keyParam = isAdmin ? `&key=${adminKey}` : ''
    pollRef.current = setInterval(() => {
      fetch(`/api/meeting?id=${meetingId}${keyParam}`)
        .then(r => r.json())
        .then(data => {
          if (data.success && data.meeting?.state) {
            setMeetingState(data.meeting.state)
          }
          // RTC signaling handled by dedicated WebRTC effect
        })
        .catch(() => {})
    }, 2000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [meetingData, meetingId, isAdmin, adminKey])

  // Elapsed timer
  useEffect(() => {
    if (!joined) return
    const t = setInterval(() => setElapsed(p => p + 1), 1000)
    return () => clearInterval(t)
  }, [joined])

  // Capture webcam — VIDEO + AUDIO (fallback to video-only if mic denied)
  // Audio track starts DISABLED (enabled after AI videos finish or user unmutes)
  useEffect(() => {
    if (!joined) return

    const tryCapture = async () => {
      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
        console.log('[CAM] Got video+audio stream')
      } catch (e1) {
        console.warn('[CAM] Audio+video failed, trying video only...', e1)
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
          console.log('[CAM] Got video-only stream (audio denied)')
        } catch (e2) {
          console.error('[CAM] getUserMedia failed entirely:', e2)
          return
        }
      }
      // Disable audio tracks initially — will be enabled after AI videos finish
      stream.getAudioTracks().forEach(t => { t.enabled = false })
      localStreamRef.current = stream
      setLocalStream(stream)
      const vid = liveVideoRef.current
      if (vid) {
        vid.srcObject = stream
      } else {
        setTimeout(() => {
          const v = liveVideoRef.current
          if (v) { v.srcObject = stream; console.log('[CAM] Stream attached (retry)') }
        }, 500)
      }
    }
    tryCapture()

    return () => {
      localStreamRef.current?.getTracks().forEach(t => t.stop())
      localStreamRef.current = null
      setLocalStream(null)
    }
  }, [joined]) // eslint-disable-line react-hooks/exhaustive-deps

  // Safety net: re-attach stream if video ref changes (e.g. re-render)
  useEffect(() => {
    const vid = liveVideoRef.current
    if (vid && localStream && !vid.srcObject) {
      vid.srcObject = localStream
      console.log('[CAM] Re-attached stream via safety net')
    }
  }, [localStream, joined])

  // Toggle video track on/off
  useEffect(() => {
    localStream?.getVideoTracks().forEach(t => { t.enabled = !isVideoOff })
  }, [isVideoOff, localStream])

  // Toggle audio track (mute/unmute) — affects WebRTC outgoing audio
  // During AI scenario, mic stays muted regardless of toggle
  useEffect(() => {
    if (!meetingEndedRef.current && isMuted) {
      // During scenario, keep audio disabled
      localStream?.getAudioTracks().forEach(t => { t.enabled = false })
    } else {
      localStream?.getAudioTracks().forEach(t => { t.enabled = !isMuted })
    }
  }, [isMuted, localStream])

  // Timeline ticker — controls which participant's audio is heard
  useEffect(() => {
    if (!joined || !meetingData) return

    let lastSpeaker: string | null = null
    let logCounter = 0
    const tick = () => {
      if (playStartRef.current === 0) return
      const now = (Date.now() - playStartRef.current) / 1000
      const activeSeg = meetingData.timeline.find(s => now >= s.startTime && now <= s.endTime)
      const currentSpeaker = activeSeg ? activeSeg.participantId : null
      setSpeakingId(currentSpeaker)

      // After scenario: enforce silence on EVERY tick (100ms safety net)
      if (meetingEndedRef.current) {
        meetingData.participants.forEach(p => {
          const vid = videoRefs.current[p.id]
          if (vid && vid.volume > 0) vid.volume = 0
        })
        return
      }

      meetingData.participants.forEach(p => {
        const vid = videoRefs.current[p.id]
        if (!vid) return
        const isSpeaker = (p.id === currentSpeaker)
        // Use volume (not muted) — muted toggling is blocked by browsers without gesture
        vid.volume = isSpeaker ? 1 : 0

        // If video is paused or stalled, try to resume
        if (vid.paused || vid.readyState < 2) {
          vid.play().catch(() => {})
        }
      })

      // Detailed state log every 2 seconds
      logCounter++
      if (logCounter % 20 === 0) {
        const states = meetingData.participants.map(p => {
          const v = videoRefs.current[p.id]
          if (!v) return `${p.name}:NO_REF`
          return `${p.name}:${v.paused ? 'PAUSED' : 'PLAY'} t=${v.currentTime.toFixed(1)} vol=${v.volume}`
        }).join(' | ')
        console.log(`[STATE] clock=${now.toFixed(1)}s speaker=${currentSpeaker || 'none'} | ${states}`)
      }

      if (currentSpeaker !== lastSpeaker) {
        const name = currentSpeaker ? meetingData.participants.find(p => p.id === currentSpeaker)?.name : 'nobody'
        const states = meetingData.participants.map(p => {
          const v = videoRefs.current[p.id]
          return v ? `${p.name}:${v.paused?'PAUSED':'OK'} vol=${v.volume}` : `${p.name}:NULL`
        }).join(' | ')
        console.log(`[TICKER] t=${now.toFixed(1)}s speaker=${name} | ${states}`)
        lastSpeaker = currentSpeaker
      }

      if (activeSeg) {
        const speaker = meetingData.participants.find(p => p.id === activeSeg.participantId)
        setScenarioStatus(`${speaker?.name || ''} parle...`)
      } else if (now > meetingData.totalDuration && !meetingEndedRef.current) {
        // Meeting scenario ended — mute AI videos, disable loop, enable mic
        // DON'T pause: let videos play to natural end so avatars look natural
        meetingEndedRef.current = true
        setMeetingEnded(true)
        console.log('[MEETING] Scenario ended — muting AI videos, enabling mic')
        meetingData.participants.forEach(p => {
          const vid = videoRefs.current[p.id]
          if (vid) {
            vid.volume = 0
            vid.loop = false // stop looping — video will end naturally on last frame
          }
        })
        // Enable mic audio tracks for live discussion
        localStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = true })
        setIsMuted(false)
        setScenarioStatus('') // No visible status — keep it natural
      } else if (meetingEndedRef.current) {
        setScenarioStatus('') // Stay silent — no indication
      } else {
        setScenarioStatus('')
      }
    }

    timerRef.current = setInterval(tick, 100)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [joined, meetingData])

  // Start all videos — videos are pre-loaded as blobs, so playback is instant (no network)
  const startAllVideos = useCallback(async (syncToTime?: number) => {
    if (!meetingData) return
    const startOffset = syncToTime || 0
    console.log(`[PLAY] Starting ${meetingData.participants.length} videos from memory, sync=${startOffset.toFixed(1)}s`)

    // Mark all videos as loading briefly
    const loadingState: Record<string, boolean> = {}
    meetingData.participants.forEach(p => { loadingState[p.id] = true })
    setVideoLoading(loadingState)

    const startSingleVideo = async (p: MeetingParticipant, retryCount = 0): Promise<void> => {
      const vid = videoRefs.current[p.id]
      if (!vid) return

      // Videos are blob URLs (in memory) — should be ready almost instantly
      if (vid.readyState < 2) {
        await new Promise<void>(resolve => {
          const onReady = () => { vid.removeEventListener('canplay', onReady); resolve() }
          vid.addEventListener('canplay', onReady)
          vid.load()
          setTimeout(resolve, 5000) // 5s is generous for blob URL
        })
      }

      // Sync to correct time position
      if (startOffset > 0 && vid.duration > 0) {
        vid.currentTime = startOffset > vid.duration ? startOffset % vid.duration : startOffset
      }

      // Use volume=0 (NOT muted) — muted toggling blocked by browsers without gesture
      vid.muted = false
      vid.volume = 0

      try {
        await vid.play()
        console.log(`[PLAY] ${p.name}: playing from memory (d=${vid.duration.toFixed(1)}s)`)
        setVideoLoading(prev => ({ ...prev, [p.id]: false }))
      } catch (err: any) {
        console.warn(`[PLAY] ${p.name}: play failed (attempt ${retryCount}): ${err.message}`)
        if (retryCount < 3) {
          if (err.name === 'NotAllowedError') {
            vid.muted = true
            vid.volume = 0
            try {
              await vid.play()
              console.log(`[PLAY] ${p.name}: playing muted (fallback)`)
              setVideoLoading(prev => ({ ...prev, [p.id]: false }))
              setAudioBlocked(true)
              return
            } catch {}
          }
          await new Promise(r => setTimeout(r, 1000 * (retryCount + 1)))
          return startSingleVideo(p, retryCount + 1)
        }
        setVideoLoading(prev => ({ ...prev, [p.id]: false }))
      }
    }

    // Start all in parallel — blob URLs = instant, no buffering
    await Promise.all(meetingData.participants.map(p => startSingleVideo(p)))

    playStartRef.current = Date.now() - (startOffset * 1000)
    console.log(`[PLAY] All started from memory, playStartRef=${playStartRef.current}`)
  }, [meetingData])

  // Notify server of join/leave
  const updateState = useCallback(async (action: string) => {
    await fetch('/api/meeting', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: meetingId, action, key: isAdmin ? adminKey : undefined }),
    }).catch(() => {})
  }, [meetingId, isAdmin, adminKey])

  // Ref to track pending sync time
  const pendingSyncRef = useRef<number | null>(null)

  // Handle join — requires user click (browser autoplay policy)
  const handleJoin = useCallback(() => {
    // Unlock audio context with BOTH methods (required by browsers)
    const el = audioElRef.current
    if (el) {
      el.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA='
      el.play().catch(() => {})
    }
    // Also unlock via AudioContext (Chrome requirement)
    try {
      const ctx = new AudioContext()
      const osc = ctx.createOscillator()
      osc.connect(ctx.destination)
      osc.start()
      osc.stop(ctx.currentTime + 0.01)
      setTimeout(() => ctx.close(), 100)
    } catch {} 
    // Calculate sync time for admin joining running meeting
    if (isAdmin && meetingState.startedAt) {
      pendingSyncRef.current = (Date.now() - meetingState.startedAt) / 1000
      console.log(`[ADMIN] Will sync to ${pendingSyncRef.current.toFixed(1)}s`)
    } else {
      pendingSyncRef.current = 0
    }
    setJoined(true)
    updateState(isAdmin ? 'adminJoin' : 'clientJoin')
  }, [updateState, isAdmin, meetingState.startedAt])

  // After joining: wait for video elements to mount, then start playback
  useEffect(() => {
    if (!joined || !meetingData || playStartRef.current !== 0) return
    let cancelled = false
    let attempts = 0

    const tryStart = () => {
      if (cancelled) return
      const refs = meetingData.participants.map(p => videoRefs.current[p.id]).filter(Boolean)
      console.log(`[MEETING] tryStart attempt=${attempts}, refs=${refs.length}/${meetingData.participants.length}`)

      if (refs.length === meetingData.participants.length) {
        // All video elements mounted — ensure they are loadable
        const syncTime = pendingSyncRef.current || 0
        console.log(`[MEETING] All refs ready — starting videos at ${syncTime.toFixed(1)}s`)
        startAllVideos(syncTime)
        pendingSyncRef.current = null
      } else if (attempts < 100) {
        attempts++
        setTimeout(tryStart, 150)
      } else {
        console.error('[MEETING] Gave up waiting for video refs')
      }
    }

    // Small initial delay to let React finish rendering
    const t = setTimeout(tryStart, 400)
    return () => { cancelled = true; clearTimeout(t) }
  }, [joined, meetingData, startAllVideos])

  // Admin watching: if client joins LATER, start videos then
  useEffect(() => {
    if (!isAdmin || !joined || !meetingData) return
    if (meetingState.clientJoined && playStartRef.current === 0) {
      const syncTime = meetingState.startedAt ? (Date.now() - meetingState.startedAt) / 1000 : 0
      pendingSyncRef.current = syncTime
      let cancelled = false
      let attempts = 0
      const tryStart = () => {
        if (cancelled) return
        const refs = meetingData.participants.map(p => videoRefs.current[p.id]).filter(Boolean)
        if (refs.length === meetingData.participants.length) {
          startAllVideos(syncTime)
        } else if (attempts < 100) {
          attempts++
          setTimeout(tryStart, 150)
        }
      }
      const t = setTimeout(tryStart, 400)
      return () => { cancelled = true; clearTimeout(t) }
    }
  }, [isAdmin, joined, meetingState.clientJoined, meetingState.startedAt, meetingData, startAllVideos])

  // Watchdog: monitor videos every 3s
  // During scenario: restart paused/stalled/errored videos, preserve sync
  // After scenario: FORCE volume=0 + loop=false (safety net — AI must NEVER speak)
  useEffect(() => {
    if (!joined || !meetingData || playStartRef.current === 0) return
    const watchdog = setInterval(() => {
      if (meetingEndedRef.current) {
        // SAFETY NET: force all AI videos silent + no loop (belt-and-suspenders)
        meetingData.participants.forEach(p => {
          const vid = videoRefs.current[p.id]
          if (!vid) return
          if (vid.volume > 0) { vid.volume = 0; console.warn(`[WATCHDOG] Force-muted ${p.name}`) }
          if (vid.loop) { vid.loop = false }
        })
        return
      }
      meetingData.participants.forEach(p => {
        const vid = videoRefs.current[p.id]
        if (!vid) return
        // Restart paused videos
        if (vid.paused && vid.readyState >= 2) {
          console.warn(`[WATCHDOG] ${p.name}: paused, restarting...`)
          vid.play().catch(() => {})
        }
        // Reload errored videos — preserve currentTime for audio sync
        if (vid.error) {
          console.warn(`[WATCHDOG] ${p.name}: error ${vid.error.code}, reloading...`)
          const savedTime = vid.currentTime
          const src = vid.src
          vid.src = ''
          vid.src = src
          vid.load()
          setTimeout(() => {
            if (savedTime > 0 && vid.duration > 0) vid.currentTime = Math.min(savedTime, vid.duration)
            vid.play().catch(() => {})
          }, 2000)
        }
        // Handle stalled (buffering)
        if (vid.readyState < 2 && !vid.paused) {
          console.warn(`[WATCHDOG] ${p.name}: buffering (readyState=${vid.readyState})`)
        }
      })
    }, 3000)
    return () => clearInterval(watchdog)
  }, [joined, meetingData])

  // ==================== WebRTC: Admin <-> Client live communication ====================
  // Single self-contained effect — handles entire signaling lifecycle via async polling

  const iceServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    // Free TURN servers from Metered (relay for symmetric NAT / cross-network)
    { urls: 'turn:a.relay.metered.ca:80', username: 'e8dd65b92f6b1b4395adbc7c', credential: 'uWdJjTvz6ejPCEqm' },
    { urls: 'turn:a.relay.metered.ca:443', username: 'e8dd65b92f6b1b4395adbc7c', credential: 'uWdJjTvz6ejPCEqm' },
    { urls: 'turn:a.relay.metered.ca:443?transport=tcp', username: 'e8dd65b92f6b1b4395adbc7c', credential: 'uWdJjTvz6ejPCEqm' },
  ]

  useEffect(() => {
    if (!joined || !localStream || !meetingData) return
    let cancelled = false
    let pc: RTCPeerConnection | null = null
    const role = isAdmin ? 'ADMIN' : 'CLIENT'
    const log = (msg: string) => console.log(`[${role}-RTC] ${msg}`)

    const sleep = (ms: number) => new Promise<void>(r => { const t = setTimeout(r, ms); if (cancelled) clearTimeout(t) })

    const fetchState = async () => {
      try {
        const keyParam = isAdmin ? `&key=${adminKey}` : ''
        const res = await fetch(`/api/meeting?id=${meetingId}${keyParam}`)
        const data = await res.json()
        if (data.success) {
          if (data.meeting?.state) setMeetingState(data.meeting.state)
          return { state: data.meeting?.state, rtc: data.rtc || null }
        }
      } catch {}
      return null
    }

    const waitForICE = (peer: RTCPeerConnection): Promise<void> =>
      new Promise(resolve => {
        if (peer.iceGatheringState === 'complete') return resolve()
        const check = () => { if (peer.iceGatheringState === 'complete') { peer.removeEventListener('icegatheringstatechange', check); resolve() } }
        peer.addEventListener('icegatheringstatechange', check)
        setTimeout(resolve, 10000)
      })

    const createPeer = () => {
      const peer = new RTCPeerConnection({ iceServers })
      localStream.getTracks().forEach(track => {
        peer.addTrack(track, localStream)
        log(`Added track: ${track.kind} (enabled=${track.enabled})`)
      })
      peer.ontrack = (e) => {
        log(`Got remote track: ${e.track.kind}`)
        const rs = e.streams[0] || new MediaStream([e.track])
        setRemoteStream(rs)
      }
      peer.oniceconnectionstatechange = () => {
        log(`ICE: ${peer.iceConnectionState}`)
      }
      peer.onconnectionstatechange = () => {
        log(`Connection: ${peer.connectionState}`)
      }
      return peer
    }

    const runSignaling = async () => {
      // Small delay to ensure join PATCH has completed on server
      await sleep(1500)
      if (cancelled) return

      if (isAdmin) {
        // === ADMIN FLOW ===
        // Step 1: Wait for client to join
        log('Waiting for client to join...')
        while (!cancelled) {
          const data = await fetchState()
          if (data?.state?.clientJoined) { log('Client is in the meeting!'); break }
          await sleep(1500)
        }
        if (cancelled) return
        // Extra wait after client join so their clientJoin PATCH (which clears RTC) completes
        await sleep(2000)
        if (cancelled) return

        // Step 2: Create peer connection + offer
        log('Creating peer connection and offer...')
        pc = createPeer()
        peerRef.current = pc
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        log('Waiting for ICE candidates...')
        await waitForICE(pc)
        if (cancelled) { pc.close(); return }

        const desc = pc.localDescription
        if (!desc) { log('ERROR: no local description'); return }

        // Step 3: Send offer to server
        await fetch('/api/meeting', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: meetingId, action: 'rtcOffer', key: adminKey, offer: { type: desc.type, sdp: desc.sdp } })
        })
        log('Offer sent to server, waiting for client answer...')

        // Step 4: Poll for client's answer (fast: every 1s)
        let answerSet = false
        for (let attempt = 0; attempt < 60 && !cancelled && !answerSet; attempt++) {
          await sleep(1000)
          const data = await fetchState()
          if (data?.rtc?.answer && pc.signalingState !== 'closed') {
            log('Got answer from client! Setting remote description...')
            try {
              await pc.setRemoteDescription(new RTCSessionDescription(data.rtc.answer))
              log('Remote description set — connection establishing!')
              answerSet = true
            } catch (e: any) {
              log(`Error setting answer: ${e.message}`)
            }
          }
        }
        if (!answerSet) log('Timed out waiting for client answer (60s)')

      } else {
        // === CLIENT FLOW ===
        // Step 1: Poll for admin's offer (fast: every 1s)
        log('Waiting for admin offer...')
        let adminOffer: RTCSessionDescriptionInit | null = null
        for (let attempt = 0; attempt < 90 && !cancelled; attempt++) {
          const data = await fetchState()
          if (data?.rtc?.offer && data?.state?.adminJoined) {
            adminOffer = data.rtc.offer
            log('Got offer from admin!')
            break
          }
          await sleep(1000)
        }
        if (cancelled || !adminOffer) { log('No offer received'); return }

        // Step 2: Create peer connection + answer
        log('Creating peer connection and answer...')
        pc = createPeer()
        peerRef.current = pc
        await pc.setRemoteDescription(new RTCSessionDescription(adminOffer))
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        log('Waiting for ICE candidates...')
        await waitForICE(pc)
        if (cancelled) { pc.close(); return }

        const desc = pc.localDescription
        if (!desc) { log('ERROR: no local description'); return }

        // Step 3: Send answer to server
        await fetch('/api/meeting', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: meetingId, action: 'rtcAnswer', answer: { type: desc.type, sdp: desc.sdp } })
        })
        log('Answer sent — connection should establish!')
      }
    }

    runSignaling().catch(e => log(`Error: ${e.message}`))

    return () => {
      cancelled = true
      if (pc) { pc.close(); pc = null }
      if (peerRef.current) { peerRef.current.close(); peerRef.current = null }
      setRemoteStream(null)
    }
  }, [joined, localStream, isAdmin, meetingId, adminKey, meetingData]) // eslint-disable-line react-hooks/exhaustive-deps

  // Attach remote stream to video element when either changes
  const remoteVideoCallback = useCallback((el: HTMLVideoElement | null) => {
    remoteVideoRef.current = el
    if (el && remoteStream) {
      el.srcObject = remoteStream
      el.play().catch(() => {})
      console.log('[RTC] Remote stream attached to video element')
    }
  }, [remoteStream])

  // Also re-attach if remoteStream changes while video element exists
  useEffect(() => {
    const el = remoteVideoRef.current
    if (el && remoteStream) {
      el.srcObject = remoteStream
      el.play().catch(() => {})
      console.log('[RTC] Remote stream re-attached via effect')
    }
  }, [remoteStream])

  // --- LOADING ---
  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#1a1a2e]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-4 border-[#5b5fc7] border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-400 text-sm">Chargement de la reunion...</p>
        </div>
      </div>
    )
  }

  // --- ERROR ---
  if (loadError || !meetingData) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#1a1a2e]">
        <div className="flex flex-col items-center gap-4">
          <div className="text-4xl">❌</div>
          <h1 className="text-xl font-semibold text-white">Reunion introuvable</h1>
          <p className="text-gray-400 text-sm">{loadError || 'Ce lien de reunion est invalide ou a expire.'}</p>
        </div>
      </div>
    )
  }

  // --- JOIN / LOBBY SCREEN ---
  if (!joined) {
    // Admin: client is LIVE — show urgent join screen
    if (isAdmin && (meetingState.started || meetingState.clientJoined)) {
      return (
        <div className="h-screen flex items-center justify-center bg-[#0f0a1e]">
          <audio ref={audioElRef} />
          <div className="flex flex-col items-center gap-5 max-w-md text-center px-4">
            <div className="relative">
              <div className="w-20 h-20 rounded-full bg-green-500/20 flex items-center justify-center animate-pulse">
                <div className="w-14 h-14 rounded-full bg-green-500/40 flex items-center justify-center">
                  <div className="w-4 h-4 rounded-full bg-green-400" />
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 bg-green-600/20 border border-green-500/40 rounded-full px-4 py-1.5">
              <span className="text-xs text-green-300 font-bold">● CLIENT EN DIRECT</span>
            </div>
            <h1 className="text-2xl font-bold text-white">{meetingData.title}</h1>
            <p className="text-green-400 text-sm font-medium">Le client est dans la reunion en ce moment</p>
            {meetingState.startedAt && (
              <p className="text-gray-500 text-xs">
                En cours depuis {Math.floor((Date.now() - meetingState.startedAt) / 1000)}s
              </p>
            )}
            <input
              type="text"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="Votre nom..."
              className="w-full max-w-[240px] bg-[#1a1a2e] text-white text-center text-sm rounded-lg px-4 py-2.5 outline-none border border-green-500/30 focus:border-green-400 placeholder-gray-500"
            />
            {/* Video preload progress for admin urgent join */}
            {!preloadDone && (
              <div className="w-full max-w-[240px]">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] text-gray-400">Chargement videos...</span>
                  <span className="text-[11px] text-green-400 font-medium">{preloadProgress}%</span>
                </div>
                <div className="w-full h-1.5 bg-[#2a2a2a] rounded-full overflow-hidden">
                  <div className="h-full bg-green-500 rounded-full transition-all duration-300" style={{ width: `${preloadProgress}%` }} />
                </div>
              </div>
            )}
            <button
              onClick={handleJoin}
              disabled={!preloadDone}
              className={`font-bold px-12 py-4 rounded-xl text-lg transition-all shadow-lg ${
                !preloadDone
                  ? 'bg-gray-600 text-gray-400 cursor-not-allowed shadow-none'
                  : 'bg-green-600 hover:bg-green-700 text-white shadow-green-600/40 animate-pulse hover:animate-none'
              }`}
            >
              {preloadDone ? 'REJOINDRE EN DIRECT' : 'CHARGEMENT...'}
            </button>
            <p className="text-gray-600 text-[11px]">Vous serez synchronise a la position actuelle du client</p>
          </div>
        </div>
      )
    }

    // Normal lobby (client, or admin waiting for client)
    return (
      <div className="h-screen flex items-center justify-center bg-[#1a1a2e]">
        <audio ref={audioElRef} />
        <div className="flex flex-col items-center gap-6 max-w-md text-center px-4">
          <svg viewBox="0 0 24 24" className="w-16 h-16" fill="none">
            <path d="M20.5 6h-3.5V4.5A1.5 1.5 0 0015.5 3h-7A1.5 1.5 0 007 4.5V6H3.5A1.5 1.5 0 002 7.5v9A1.5 1.5 0 003.5 18H7v1.5A1.5 1.5 0 008.5 21h7a1.5 1.5 0 001.5-1.5V18h3.5a1.5 1.5 0 001.5-1.5v-9A1.5 1.5 0 0020.5 6z" fill="#5b5fc7"/>
            <path d="M9.5 8h5v2h-2v5h-1v-5h-2V8z" fill="white"/>
          </svg>

          {isAdmin && (
            <div className="flex items-center gap-2 bg-indigo-600/20 border border-indigo-500/40 rounded-full px-4 py-1.5">
              <Eye className="w-4 h-4 text-indigo-400" />
              <span className="text-xs text-indigo-300 font-semibold">MODE ADMIN</span>
            </div>
          )}

          <h1 className="text-2xl font-semibold text-white">{meetingData.title}</h1>

          <div className="flex flex-wrap justify-center gap-2">
            {meetingData.participants.map(p => (
              <div key={p.id} className="flex items-center gap-2 bg-[#2d2c2c] rounded-full px-3 py-1">
                <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: p.color }}>
                  {p.name.charAt(0)}
                </div>
                <span className="text-xs text-gray-300">{p.name}</span>
              </div>
            ))}
          </div>

          {/* Status indicators for admin waiting */}
          {isAdmin && (
            <div className="flex flex-col gap-2 w-full">
              <div className="flex items-center gap-2 justify-center text-sm text-gray-500">
                <div className="w-2 h-2 rounded-full bg-gray-600" />
                En attente du client...
              </div>
            </div>
          )}

          <p className="text-gray-400 text-sm">
            {meetingData.participants.length} participant{meetingData.participants.length > 1 ? 's' : ''} IA
            {isAdmin ? ' — Vous etes l\'admin' : ' + vous'}
          </p>

          {/* Video preload progress bar */}
          {!preloadDone && (
            <div className="w-full max-w-[280px]">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] text-gray-400">Preparation de la reunion...</span>
                <span className="text-[11px] text-[#5b5fc7] font-medium">{preloadProgress}%</span>
              </div>
              <div className="w-full h-1.5 bg-[#2a2a2a] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#5b5fc7] rounded-full transition-all duration-300"
                  style={{ width: `${preloadProgress}%` }}
                />
              </div>
            </div>
          )}

          <input
            type="text"
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
            placeholder="Votre nom..."
            className="w-full max-w-[260px] bg-[#201f1f] text-white text-center text-sm rounded-lg px-4 py-2.5 outline-none border border-[#383838] focus:border-[#5b5fc7] placeholder-gray-500"
          />

          <button
            onClick={handleJoin}
            disabled={!preloadDone}
            className={`font-semibold px-10 py-3.5 rounded-lg text-[16px] transition-colors shadow-lg ${
              !preloadDone
                ? 'bg-gray-600 text-gray-400 cursor-not-allowed shadow-none'
                : isAdmin
                  ? 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-600/30'
                  : 'bg-[#5b5fc7] hover:bg-[#4a4eb5] text-white shadow-[#5b5fc7]/30'
            }`}
          >
            {isAdmin ? 'Rejoindre (Admin)' : 'Rejoindre la reunion'}
          </button>
        </div>
      </div>
    )
  }

  // --- MEETING VIEW ---
  // Count tiles: AI participants + self + remote person (admin on client side, client on admin side)
  const showClientTile = true // always show self or client placeholder
  const showAdminOnClient = !isAdmin && !!remoteStream // client sees admin tile only when WebRTC stream is live
  const totalTiles = meetingData.participants.length + 1 + (isAdmin ? 1 : 0) + (showAdminOnClient ? 1 : 0)
  // Responsive: fewer cols on small screens
  const getResponsiveCols = () => {
    if (typeof window === 'undefined') return 3
    const w = window.innerWidth
    if (w < 640) return totalTiles <= 2 ? 1 : 2 // mobile
    if (w < 1024) return totalTiles <= 2 ? 2 : 2 // tablet
    return totalTiles <= 2 ? 2 : totalTiles <= 4 ? 2 : totalTiles <= 6 ? 3 : 4 // desktop
  }
  const cols = getResponsiveCols()

  return (
    <div className="h-screen flex flex-col bg-[#201f1f] overflow-hidden">
      <audio ref={audioElRef} />

      {/* Top bar — responsive */}
      <div className="h-[44px] sm:h-[48px] bg-[#292828] flex items-center px-2 sm:px-3 border-b border-[#383838]">
        <div className="w-[40px] sm:w-[68px] flex items-center justify-center">
          <svg viewBox="0 0 24 24" className="w-5 h-5 sm:w-6 sm:h-6" fill="none">
            <path d="M20.5 6h-3.5V4.5A1.5 1.5 0 0015.5 3h-7A1.5 1.5 0 007 4.5V6H3.5A1.5 1.5 0 002 7.5v9A1.5 1.5 0 003.5 18H7v1.5A1.5 1.5 0 008.5 21h7a1.5 1.5 0 001.5-1.5V18h3.5a1.5 1.5 0 001.5-1.5v-9A1.5 1.5 0 0020.5 6z" fill="#5b5fc7"/>
            <path d="M9.5 8h5v2h-2v5h-1v-5h-2V8z" fill="white"/>
          </svg>
        </div>
        <div className="flex-1 flex justify-center items-center gap-2 sm:gap-3 min-w-0">
          <span className="text-[11px] sm:text-[13px] text-gray-300 font-medium truncate">{meetingData.title}</span>
          {isAdmin && (
            <span className="text-[9px] sm:text-[10px] bg-indigo-600/30 text-indigo-300 px-1.5 sm:px-2 py-0.5 rounded-full font-bold flex-shrink-0">ADMIN</span>
          )}
        </div>
        <div className="flex items-center gap-1 sm:gap-2">
          {isAdmin && (
            <div className="flex items-center gap-1 sm:gap-2 mr-1 sm:mr-2">
              <div className={`flex items-center gap-1 text-[9px] sm:text-[10px] ${meetingState.clientJoined ? 'text-green-400' : 'text-gray-600'}`}>
                <div className={`w-1.5 h-1.5 rounded-full ${meetingState.clientJoined ? 'bg-green-400 animate-pulse' : 'bg-gray-600'}`} />
                <span className="hidden sm:inline">Client</span>
              </div>
            </div>
          )}
          {scenarioStatus && (
            <span className="text-[10px] sm:text-[11px] text-[#5b5fc7] font-medium truncate max-w-[100px] sm:max-w-none">{scenarioStatus}</span>
          )}
          <MoreHorizontal className="w-4 h-4 sm:w-5 sm:h-5 text-gray-500 cursor-pointer" />
        </div>
      </div>

      {/* Audio blocked banner — click to unmute */}
      {audioBlocked && (
        <button
          onClick={() => {
            // User gesture: unmute all videos
            if (meetingData) {
              meetingData.participants.forEach(p => {
                const vid = videoRefs.current[p.id]
                if (vid) {
                  vid.muted = false
                  // Keep volume as ticker manages it
                }
              })
            }
            setAudioBlocked(false)
          }}
          className="w-full bg-amber-600 hover:bg-amber-500 text-white text-sm font-medium py-2 px-4 flex items-center justify-center gap-2 transition-colors"
        >
          <Mic className="w-4 h-4" />
          Cliquez ici pour activer le son
        </button>
      )}

      {/* Main layout */}
      <div className="flex-1 flex flex-col">
        <MeetingToolbar
          isMuted={isMuted}
          isVideoOff={isVideoOff}
          onToggleMute={() => setIsMuted(!isMuted)}
          onToggleVideo={() => setIsVideoOff(!isVideoOff)}
          onToggleChat={() => { setShowChat(!showChat); setShowParticipants(false) }}
          onToggleParticipants={() => { setShowParticipants(!showParticipants); setShowChat(false) }}
          participantCount={totalTiles}
          elapsed={elapsed}
        />

        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 bg-[#201f1f] flex items-center justify-center p-1 sm:p-2 md:p-4">
            <div
              className="grid gap-1 sm:gap-2 w-full h-full auto-rows-fr"
              style={{
                gridTemplateColumns: `repeat(${cols}, 1fr)`,
                maxWidth: totalTiles <= 2 ? '900px' : totalTiles <= 4 ? '1100px' : '100%',
                alignContent: 'center',
              }}
            >
              {/* AI Participants — continuous videos */}
              {meetingData.participants.map((p) => {
                const isSpeaking = meetingEnded ? false : speakingId === p.id
                return (
                  <div
                    key={p.id}
                    className={`relative rounded-lg overflow-hidden transition-all duration-200 ${
                      isSpeaking ? 'ring-2 ring-green-500 z-10' : 'ring-1 ring-[#3b3b3b]'
                    }`}
                    style={{ backgroundColor: '#1a1a1a', aspectRatio: '16/9' }}
                  >
                    <video
                      ref={el => { videoRefs.current[p.id] = el }}
                      src={videoBlobUrls[p.id] || p.videoUrl}
                      preload="auto"
                      playsInline
                      loop={!meetingEnded}
                      crossOrigin="anonymous"
                      className="absolute inset-0 w-full h-full object-cover"
                    />

                    {/* Loading overlay */}
                    {videoLoading[p.id] && (
                      <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-[#1a1a1a]/80">
                        <div className="w-8 h-8 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
                        <span className="text-[11px] text-gray-400 mt-2">Chargement...</span>
                      </div>
                    )}

                    {/* Name label */}
                    <div className="absolute bottom-0 left-0 right-0 z-20">
                      <div className="flex items-center gap-1.5 bg-gradient-to-t from-black/60 to-transparent px-3 py-2">
                        <div className={`rounded-full p-0.5 ${!isSpeaking ? 'bg-red-600' : ''}`}>
                          {!isSpeaking
                            ? <MicOff className="w-3 h-3 text-white" />
                            : <Mic className="w-3 h-3 text-white" />
                          }
                        </div>
                        <span className="text-[13px] text-white font-medium drop-shadow-sm">{p.name}</span>
                      </div>
                    </div>
                  </div>
                )
              })}

              {/* Client webcam tile (visible when not admin, or when admin sees client is connected) */}
              {showClientTile && (
                <div
                  className="relative rounded-lg overflow-hidden ring-1 ring-[#3b3b3b]"
                  style={{ backgroundColor: '#2d2d2d', aspectRatio: '16/9' }}
                >
                  {!isAdmin ? (
                    <>
                      <video
                        ref={liveVideoRef}
                        autoPlay
                        playsInline
                        muted
                        className="absolute inset-0 w-full h-full object-cover"
                        style={{ transform: 'scaleX(-1)', opacity: isVideoOff ? 0 : 1 }}
                      />
                      {isVideoOff && (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="w-16 h-16 rounded-full bg-[#5b5fc7] flex items-center justify-center text-white text-xl font-bold">C</div>
                        </div>
                      )}
                    </>
                  ) : (
                    // Admin sees client's live webcam via WebRTC, or placeholder
                    <>
                      {remoteStream ? (
                        <video
                          ref={remoteVideoCallback}
                          autoPlay
                          playsInline
                          className="absolute inset-0 w-full h-full object-cover"
                          style={{ transform: 'scaleX(-1)' }}
                        />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center">
                          {meetingState.clientJoined ? (
                            <div className="flex flex-col items-center gap-2">
                              <div className="w-14 h-14 rounded-full bg-green-600 flex items-center justify-center text-white text-lg font-bold animate-pulse">C</div>
                              <span className="text-[11px] text-green-400">Connexion...</span>
                            </div>
                          ) : (
                            <div className="flex flex-col items-center gap-2">
                              <div className="w-14 h-14 rounded-full bg-gray-700 flex items-center justify-center">
                                <Users className="w-6 h-6 text-gray-500" />
                              </div>
                              <span className="text-[11px] text-gray-500">En attente...</span>
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                  <div className="absolute bottom-0 left-0 right-0 z-20">
                    <div className="flex items-center gap-1.5 bg-gradient-to-t from-black/60 to-transparent px-3 py-2">
                      <span className="text-[13px] text-white font-medium drop-shadow-sm">
                        {isAdmin ? 'Client' : `${displayName} (Vous)`}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Admin webcam tile (admin sees their own cam) */}
              {isAdmin && (
                <div
                  className="relative rounded-lg overflow-hidden ring-1 ring-indigo-500/50"
                  style={{ backgroundColor: '#1e1b4b', aspectRatio: '16/9' }}
                >
                  <video
                    ref={liveVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className="absolute inset-0 w-full h-full object-cover"
                    style={{ transform: 'scaleX(-1)', opacity: isVideoOff ? 0 : 1 }}
                  />
                  {isVideoOff && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="w-16 h-16 rounded-full bg-indigo-600 flex items-center justify-center text-white text-xl font-bold">A</div>
                    </div>
                  )}
                  <div className="absolute bottom-0 left-0 right-0 z-20">
                    <div className="flex items-center gap-1.5 bg-gradient-to-t from-black/60 to-transparent px-3 py-2">
                      <Eye className="w-3 h-3 text-indigo-300" />
                      <span className="text-[13px] text-indigo-200 font-medium drop-shadow-sm">{displayName} (Vous)</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Admin tile on CLIENT side — shows admin's live webcam via WebRTC */}
              {showAdminOnClient && (
                <div
                  className="relative rounded-lg overflow-hidden ring-2 ring-indigo-500/70"
                  style={{ backgroundColor: '#1e1b4b', aspectRatio: '16/9' }}
                >
                  {remoteStream ? (
                    <video
                      ref={remoteVideoCallback}
                      autoPlay
                      playsInline
                      className="absolute inset-0 w-full h-full object-cover"
                      style={{ transform: 'scaleX(-1)' }}
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="flex flex-col items-center gap-2">
                        <div className="w-14 h-14 rounded-full bg-indigo-600 flex items-center justify-center text-white text-lg font-bold animate-pulse">A</div>
                        <span className="text-[11px] text-indigo-400">Connexion...</span>
                      </div>
                    </div>
                  )}
                  <div className="absolute bottom-0 left-0 right-0 z-20">
                    <div className="flex items-center gap-1.5 bg-gradient-to-t from-black/60 to-transparent px-3 py-2">
                      <Eye className="w-3 h-3 text-indigo-300" />
                      <span className="text-[13px] text-indigo-200 font-medium drop-shadow-sm">Interlocuteur</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Side panel — overlay on mobile, sidebar on desktop */}
          {(showChat || showParticipants) && (
            <div className="absolute right-0 top-[44px] sm:top-[48px] bottom-0 w-full sm:w-[320px] sm:relative sm:top-0 z-30 bg-[#2d2c2c] border-l border-[#383838] flex flex-col">
              <div className="flex items-center justify-between px-4 py-3 border-b border-[#383838]">
                <h3 className="text-[14px] font-semibold text-white">
                  {showParticipants ? `Participants (${totalTiles})` : 'Conversation'}
                </h3>
                <button onClick={() => { setShowChat(false); setShowParticipants(false) }} className="hover:bg-[#3a3a3a] p-1 rounded">
                  <X className="w-4 h-4 text-gray-400" />
                </button>
              </div>
              {showParticipants && (
                <div className="flex-1 overflow-y-auto p-2">
                  {meetingData.participants.map(p => (
                    <div key={p.id} className="flex items-center gap-3 py-2 px-3 rounded-md hover:bg-[#3a3a3a]">
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold text-white flex-shrink-0" style={{ background: p.color }}>
                        {p.name.charAt(0)}
                      </div>
                      <span className="text-[13px] text-gray-300">{p.name}</span>
                    </div>
                  ))}
                  <div className="flex items-center gap-3 py-2 px-3 rounded-md hover:bg-[#3a3a3a]">
                    <div className={`w-2 h-2 rounded-full ${meetingState.clientJoined ? 'bg-green-400' : 'bg-gray-600'}`} />
                    <span className="text-[13px] text-gray-300">Client {meetingState.clientJoined ? '' : '(hors ligne)'}</span>
                  </div>
                  {isAdmin && (
                    <div className="flex items-center gap-3 py-2 px-3 rounded-md hover:bg-[#3a3a3a]">
                      <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-sm font-semibold text-white flex-shrink-0">A</div>
                      <span className="text-[13px] text-indigo-300">Admin (Vous)</span>
                    </div>
                  )}
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
  )
}

export default function MeetingRoom() {
  return (
    <Suspense fallback={
      <div className="h-screen flex items-center justify-center bg-[#1a1a2e]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-4 border-[#5b5fc7] border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-400 text-sm">Chargement de la reunion...</p>
        </div>
      </div>
    }>
      <MeetingRoomInner />
    </Suspense>
  )
}
