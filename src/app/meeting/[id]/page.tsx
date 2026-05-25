'use client'

import React, { useState, useEffect, useRef, useCallback, Suspense } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import MeetingToolbar from '../../../components/MeetingToolbar'
import { Mic, MicOff, MoreHorizontal, X, StopCircle } from 'lucide-react'
import { io, Socket } from 'socket.io-client'

interface MeetingParticipant {
  id: string
  name: string
  color: string
  videoUrl: string
  idleVideoUrl?: string
  role?: 'speaker' | 'listener'
}

interface TimelineSegment {
  participantId: string
  startTime: number
  endTime: number
}

interface MeetingData {
  id: string
  title: string
  participants: MeetingParticipant[]
  timeline: TimelineSegment[]
  totalDuration: number
  excludedParticipants?: string[]
  ended?: boolean
  isTemplate?: boolean
  templateId?: string
  clientName?: string
  singleUse?: boolean
  consumed?: boolean
  state?: {
    started: boolean
    startedAt: number | null
    clientJoined: boolean
  }
}

function MeetingRoomInner() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const meetingId = params.id as string
  const adminKey = searchParams.get('admin') || ''
  const isAdmin = !!adminKey

  const [meetingData, setMeetingData] = useState<MeetingData | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [joined, setJoined] = useState(false)
  const [isTemplate, setIsTemplate] = useState(false) // true if this is a template link (needs clone)
  const [elapsed, setElapsed] = useState(0)
  const [showChat, setShowChat] = useState(false)
  const [showParticipants, setShowParticipants] = useState(false)
  const [speakingId, setSpeakingId] = useState<string | null>(null)
  const [scenarioStatus, setScenarioStatus] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [videoLoading, setVideoLoading] = useState<Record<string, boolean>>({})
  const [audioBlocked, setAudioBlocked] = useState(false)
  const [meetingEnded, setMeetingEnded] = useState(false)
  const meetingEndedRef = useRef(false)
  const clientVideoRef = useRef<HTMLVideoElement>(null)
  const [clientCameraOn, setClientCameraOn] = useState(false)
  const [clientMicOn, setClientMicOn] = useState(false)
  const [excludedIds, setExcludedIds] = useState<Set<string>>(new Set())
  const [meetingKilled, setMeetingKilled] = useState(false) // admin ended the meeting permanently

  // Télécommande IA: admin controls when each speech block plays
  const [manualMode, setManualMode] = useState(false) // true = admin controls playback
  const [activeSegIndex, setActiveSegIndex] = useState<number | null>(null) // currently playing segment
  const [segmentFinished, setSegmentFinished] = useState(false) // true when current segment ended, waiting for next
  const [showTelecommande, setShowTelecommande] = useState(false) // show/hide panel
  const manualModeRef = useRef(false)
  const activeSegIndexRef = useRef<number | null>(null)

  // Preload: download videos fully into memory (blob URLs) before playback
  const [videoBlobUrls, setVideoBlobUrls] = useState<Record<string, string>>({})
  const [idleBlobUrls, setIdleBlobUrls] = useState<Record<string, string>>({})
  const [preloadProgress, setPreloadProgress] = useState(0) // 0-100
  const [preloadDone, setPreloadDone] = useState(false)

  const audioElRef = useRef<HTMLAudioElement>(null)
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({})
  const idleVideoRefs = useRef<Record<string, HTMLVideoElement | null>>({})
  const playStartRef = useRef<number>(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // WebRTC + Socket.IO state
  const [peerInMeeting, setPeerInMeeting] = useState(false)
  const [remoteConnected, setRemoteConnected] = useState(false)
  const [remoteName, setRemoteName] = useState('')
  const localStreamRef = useRef<MediaStream | null>(null)
  const remoteVideoRef = useRef<HTMLVideoElement>(null)
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null)
  const socketRef = useRef<Socket | null>(null)
  const remoteSocketIdRef = useRef<string | null>(null)
  const iceCandidateQueueRef = useRef<RTCIceCandidateInit[]>([])
  const makingOfferRef = useRef(false)
  const remoteStreamRef = useRef<MediaStream | null>(null)

  // Fetch meeting data — if template, show lobby to enter name then clone
  useEffect(() => {
    if (!meetingId) return
    fetch(`/api/meeting?id=${meetingId}`)
      .then(r => r.json())
      .then(data => {
        if (data.success && data.meeting) {
          // Check if single-use link was already consumed (admin bypasses this)
          if (data.meeting.singleUse && data.meeting.consumed && !isAdmin) {
            setLoadError('This meeting link has already been used.')
          } else if (data.meeting.isTemplate) {
            // This is a template link — show lobby, clone on join
            setIsTemplate(true)
            setMeetingData(data.meeting)
          } else {
            setMeetingData(data.meeting)
          }
        } else {
          setLoadError(data.error || 'Meeting not found')
        }
        setLoading(false)
      })
      .catch(() => {
        setLoadError('Connection error')
        setLoading(false)
      })
  }, [meetingId])

  // Poll for admin changes (exclusions + meeting end) every 3s
  useEffect(() => {
    if (!meetingId || !joined) return
    const poll = setInterval(async () => {
      try {
        const res = await fetch(`/api/meeting?id=${meetingId}`)
        const data = await res.json()
        if (!data.success || !data.meeting) return
        const m = data.meeting

        // Update excluded participants
        const newExcluded = new Set<string>(m.excludedParticipants || [])
        setExcludedIds(prev => {
          // Only update if changed
          if (prev.size !== newExcluded.size || !Array.from(newExcluded).every(id => prev.has(id))) {
            // Mute + pause excluded participants
            newExcluded.forEach(pid => {
              const vid = videoRefs.current[pid]
              if (vid) { vid.volume = 0; vid.pause() }
              const idle = idleVideoRefs.current[pid]
              if (idle) { idle.pause() }
            })
            return newExcluded
          }
          return prev
        })

        // Admin ended the meeting permanently
        if (m.ended && !meetingKilled) {
          setMeetingKilled(true)
          // Stop ALL videos
          if (meetingData) {
            meetingData.participants.forEach(p => {
              const vid = videoRefs.current[p.id]
              if (vid) { vid.volume = 0; vid.pause() }
              const idle = idleVideoRefs.current[p.id]
              if (idle) { idle.pause() }
            })
          }
          // Stop client webcam
          if (clientVideoRef.current?.srcObject) {
            const tracks = (clientVideoRef.current.srcObject as MediaStream).getTracks()
            tracks.forEach(t => t.stop())
            clientVideoRef.current.srcObject = null
          }
          setClientCameraOn(false)
          console.log('[ADMIN] Meeting ended by admin — everything stopped')
        }
      } catch {}
    }, 3000)
    return () => clearInterval(poll)
  }, [meetingId, joined, meetingKilled, meetingData])

  // Preload videos into memory as blob URLs — zero network dependency during playback
  // STRATEGY: Join button enables as soon as MAIN videos are ready. Idle videos download in background.
  // Also has a hard timeout: if a main video can't be preloaded in 90s, fall back to streaming (remote URL).
  useEffect(() => {
    if (!meetingData || preloadDone) return
    let cancelled = false

    const downloadAsBlob = async (url: string, label: string, timeoutMs = 90000): Promise<{ blobUrl: string; size: number } | null> => {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const res = await fetch(url, { signal: controller.signal })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const reader = res.body?.getReader()
        if (!reader) throw new Error('No reader')
        const chunks: BlobPart[] = []
        let received = 0
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (cancelled) { reader.cancel(); return null }
          chunks.push(value)
          received += value.length
        }
        clearTimeout(timeoutId)
        if (cancelled) return null
        const blob = new Blob(chunks, { type: 'video/mp4' })
        return { blobUrl: URL.createObjectURL(blob), size: received }
      } catch (err: any) {
        clearTimeout(timeoutId)
        console.error(`[PRELOAD] ${label}: failed — ${err.message}`)
        return null
      }
    }

    const preloadAll = async () => {
      const participants = meetingData.participants
      if (participants.length === 0) { setPreloadDone(true); setPreloadProgress(100); return }

      const mainBlobMap: Record<string, string> = {}
      let mainLoaded = 0
      const total = participants.length

      // ============================================
      // PHASE 1: Download MAIN videos (blocks join button)
      // ============================================
      await Promise.all(participants.map(async (p) => {
        const result = await downloadAsBlob(p.videoUrl, `${p.name} (main)`)
        if (result) {
          mainBlobMap[p.id] = result.blobUrl
          console.log(`[PRELOAD] ${p.name} main: ${(result.size / 1024 / 1024).toFixed(1)}MB`)
        } else {
          console.warn(`[PRELOAD] ${p.name}: using remote URL as fallback`)
        }
        mainLoaded++
        if (!cancelled) setPreloadProgress(Math.min(99, Math.round((mainLoaded / total) * 100)))
      }))

      if (cancelled) return

      // Main videos done — enable join button immediately (even if some failed, fallback to remote URL)
      setVideoBlobUrls(mainBlobMap)
      setPreloadDone(true)
      setPreloadProgress(100)
      console.log(`[PRELOAD] Main videos done: ${Object.keys(mainBlobMap).length}/${total} cached. Join button enabled.`)

      // ============================================
      // PHASE 2: Download IDLE videos IN BACKGROUND (non-blocking)
      // These only play after scenario ends, so we have plenty of time
      // ============================================
      const idleBlobMap: Record<string, string> = {}
      const participantsWithIdle = participants.filter(p => p.idleVideoUrl)
      if (participantsWithIdle.length === 0) return

      console.log(`[PRELOAD] Starting background idle download (${participantsWithIdle.length} videos)...`)
      await Promise.all(participantsWithIdle.map(async (p) => {
        if (cancelled) return
        const result = await downloadAsBlob(p.idleVideoUrl!, `${p.name} (idle)`, 180000) // 3min timeout
        if (result && !cancelled) {
          idleBlobMap[p.id] = result.blobUrl
          console.log(`[PRELOAD] ${p.name} idle: ${(result.size / 1024 / 1024).toFixed(1)}MB (background)`)
          // Update state progressively as each idle arrives
          setIdleBlobUrls(prev => ({ ...prev, [p.id]: result.blobUrl }))
        }
      }))
      console.log(`[PRELOAD] Idle videos background done: ${Object.keys(idleBlobMap).length}/${participantsWithIdle.length}`)
    }

    preloadAll()
    return () => { cancelled = true }
  }, [meetingData, preloadDone])

  // Cleanup blob URLs on unmount
  useEffect(() => {
    return () => {
      Object.values(videoBlobUrls).forEach(url => { try { URL.revokeObjectURL(url) } catch {} })
      Object.values(idleBlobUrls).forEach(url => { try { URL.revokeObjectURL(url) } catch {} })
    }
  }, [videoBlobUrls, idleBlobUrls])

  // Elapsed timer
  useEffect(() => {
    if (!joined) return
    const t = setInterval(() => setElapsed(p => p + 1), 1000)
    return () => clearInterval(t)
  }, [joined])

  // ============================================================
  // WebRTC + Socket.IO: Real-time 1-to-1 video call
  // ============================================================
  const iceServersRef = useRef<RTCIceServer[]>([
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
  ])
  const iceRestartCountRef = useRef(0)

  const createPeerConnection = useCallback((remoteSocketId: string) => {
    console.log(`[WEBRTC] Creating peer connection for remote: ${remoteSocketId}`)
    console.log(`[WEBRTC] Using ${iceServersRef.current.length} ICE servers`)

    const pc = new RTCPeerConnection({
      iceServers: iceServersRef.current,
      iceCandidatePoolSize: 10,
    })

    // Add local tracks BEFORE creating offer
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        console.log(`[WEBRTC] Adding local track: ${track.kind} (${track.id})`)
        pc.addTrack(track, localStreamRef.current!)
      })
    } else {
      console.warn('[WEBRTC] No local stream — adding recvonly transceivers')
      pc.addTransceiver('audio', { direction: 'recvonly' })
      pc.addTransceiver('video', { direction: 'recvonly' })
    }

    // Handle remote tracks
    pc.ontrack = (event) => {
      console.log(`[WEBRTC] ✅ Remote track received: ${event.track.kind}, readyState=${event.track.readyState}`)
      if (!remoteStreamRef.current) {
        remoteStreamRef.current = new MediaStream()
      }
      remoteStreamRef.current.addTrack(event.track)

      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = remoteStreamRef.current
        remoteVideoRef.current.play().catch(e => console.warn('[WEBRTC] Remote video play error:', e))
      }
      setRemoteConnected(true)
      console.log(`[WEBRTC] Remote stream now has ${remoteStreamRef.current.getTracks().length} tracks`)
    }

    // ICE candidates — send to remote via Socket.IO
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log(`[WEBRTC] Sending ICE candidate to ${remoteSocketId}: ${event.candidate.candidate.substring(0, 50)}...`)
        socketRef.current?.emit('ice-candidate', {
          to: remoteSocketId,
          candidate: event.candidate.toJSON(),
        })
      } else {
        console.log('[WEBRTC] ICE gathering complete')
      }
    }

    pc.oniceconnectionstatechange = () => {
      console.log(`[WEBRTC] ICE state: ${pc.iceConnectionState}`)
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        setRemoteConnected(true)
        iceRestartCountRef.current = 0
      } else if (pc.iceConnectionState === 'failed') {
        if (iceRestartCountRef.current < 3) {
          iceRestartCountRef.current++
          console.warn(`[WEBRTC] ICE FAILED — restart attempt ${iceRestartCountRef.current}/3`)
          // Create new offer with iceRestart flag
          pc.createOffer({ iceRestart: true }).then(offer => {
            return pc.setLocalDescription(offer)
          }).then(() => {
            if (remoteSocketIdRef.current && socketRef.current) {
              console.log('[WEBRTC] 📤 Sending ICE restart offer')
              socketRef.current.emit('offer', { to: remoteSocketIdRef.current, offer: pc.localDescription })
            }
          }).catch(err => console.error('[WEBRTC] ICE restart failed:', err))
        } else {
          console.error('[WEBRTC] ICE FAILED after 3 restarts — giving up')
        }
      }
    }

    pc.onconnectionstatechange = () => {
      console.log(`[WEBRTC] Connection state: ${pc.connectionState}`)
      if (pc.connectionState === 'connected') {
        setRemoteConnected(true)
        iceRestartCountRef.current = 0
      } else if (pc.connectionState === 'failed') {
        setRemoteConnected(false)
      }
    }

    pc.onsignalingstatechange = () => {
      console.log(`[WEBRTC] Signaling state: ${pc.signalingState}`)
    }

    peerConnectionRef.current = pc
    return pc
  }, [])

  // Process queued ICE candidates after remoteDescription is set
  const processIceCandidateQueue = useCallback(async () => {
    const pc = peerConnectionRef.current
    if (!pc || !pc.remoteDescription) return

    console.log(`[WEBRTC] Processing ${iceCandidateQueueRef.current.length} queued ICE candidates`)
    while (iceCandidateQueueRef.current.length > 0) {
      const candidate = iceCandidateQueueRef.current.shift()!
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate))
        console.log('[WEBRTC] Queued ICE candidate added successfully')
      } catch (err) {
        console.error('[WEBRTC] Error adding queued ICE candidate:', err)
      }
    }
  }, [])

  useEffect(() => {
    if (!joined || !meetingId) return

    const userName = displayName || (isAdmin ? 'Admin' : (meetingData?.clientName || 'Client'))
    console.log(`[SOCKET] Connecting as "${userName}" to room ${meetingId}`)

    // Fetch TURN servers for NAT traversal, then get local media
    const initMedia = async () => {
      // Fetch TURN credentials first
      try {
        const turnRes = await fetch('/api/turn-credentials')
        const turnData = await turnRes.json()
        const hasTurn = turnData.iceServers?.some((s: RTCIceServer) => 
          (typeof s.urls === 'string' ? s.urls : s.urls?.[0] || '').startsWith('turn')
        )
        if (turnData.iceServers && turnData.iceServers.length > 0) {
          iceServersRef.current = turnData.iceServers
          console.log(`[WEBRTC] ✅ Got ${turnData.iceServers.length} ICE servers (TURN included: ${hasTurn})`)
          if (turnData.error) console.warn(`[WEBRTC] TURN API warning: ${turnData.error}`)
        } else {
          console.warn('[WEBRTC] No TURN servers from API — STUN only')
        }
      } catch (err) {
        console.warn('[WEBRTC] Failed to fetch TURN credentials:', err)
      }
      // Log final ICE config
      console.log(`[WEBRTC] Final ICE servers:`, iceServersRef.current.map((s: RTCIceServer) => typeof s.urls === 'string' ? s.urls : s.urls?.[0]))

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
        localStreamRef.current = stream
        if (clientVideoRef.current) {
          clientVideoRef.current.srcObject = stream
          clientVideoRef.current.play().catch(() => {})
        }
        setClientCameraOn(true)
        setClientMicOn(true)
        console.log(`[WEBRTC] Local media acquired: ${stream.getTracks().map(t => `${t.kind}:enabled=${t.enabled}`).join(', ')}`)
      } catch (err) {
        console.warn('[WEBRTC] Camera/mic denied, trying audio only:', err)
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true })
          localStreamRef.current = stream
          setClientCameraOn(false)
          setClientMicOn(true)
          console.log('[WEBRTC] Audio only acquired')
        } catch {
          console.warn('[WEBRTC] No media at all — receive only mode')
          setClientCameraOn(false)
          setClientMicOn(false)
        }
      }

      // Connect Socket.IO AFTER media is ready
      const socket = io(window.location.origin, { path: '/socket.io' })
      socketRef.current = socket

      socket.on('connect', () => {
        console.log(`[SOCKET] ✅ Connected: ${socket.id}`)
        socket.emit('join-room', { roomId: meetingId, userName })
      })

      // When existing users are already in the room (I'm the newcomer → I WAIT for their offer)
      socket.on('existing-users', async (users: { socketId: string; userName: string }[]) => {
        console.log(`[SOCKET] Existing users in room: ${users.length}`, users)
        if (users.length > 0) {
          const remote = users[0]
          remoteSocketIdRef.current = remote.socketId
          setRemoteName(remote.userName)
          setPeerInMeeting(true)
          console.log(`[SOCKET] I'm the newcomer — waiting for offer from ${remote.userName} (${remote.socketId})`)
          // Do NOT create offer — the existing user will send one via 'user-joined' handler
        }
      })

      // When a new user joins (I'm already here → they will send offer, or I create one)
      socket.on('user-joined', async ({ socketId, userName: remoteUserName }: { socketId: string; userName: string }) => {
        console.log(`[SOCKET] 🆕 User joined: ${remoteUserName} (${socketId})`)
        remoteSocketIdRef.current = socketId
        setRemoteName(remoteUserName)
        setPeerInMeeting(true)

        // I'm User A — create peer connection and send offer
        const pc = createPeerConnection(socketId)
        makingOfferRef.current = true
        try {
          const offer = await pc.createOffer()
          await pc.setLocalDescription(offer)
          console.log(`[WEBRTC] 📤 Sending offer to ${socketId} (${offer.sdp?.length} bytes)`)
          socket.emit('offer', { to: socketId, offer: pc.localDescription })
        } catch (err) {
          console.error('[WEBRTC] Error creating offer:', err)
        } finally {
          makingOfferRef.current = false
        }
      })

      // Receive offer → create answer
      socket.on('offer', async ({ from, offer }: { from: string; offer: RTCSessionDescriptionInit }) => {
        console.log(`[WEBRTC] 📥 Received offer from ${from} (${offer.sdp?.length} bytes)`)
        remoteSocketIdRef.current = from
        setPeerInMeeting(true)

        // If we already have a PC, close it and create fresh
        if (peerConnectionRef.current) {
          peerConnectionRef.current.close()
          peerConnectionRef.current = null
        }
        iceCandidateQueueRef.current = []

        const pc = createPeerConnection(from)
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(offer))
          console.log(`[WEBRTC] ✅ Remote description set (offer)`)

          // Process any ICE candidates that arrived before remoteDescription
          await processIceCandidateQueue()

          const answer = await pc.createAnswer()
          await pc.setLocalDescription(answer)
          console.log(`[WEBRTC] 📤 Sending answer to ${from} (${answer.sdp?.length} bytes)`)
          socket.emit('answer', { to: from, answer: pc.localDescription })
        } catch (err) {
          console.error('[WEBRTC] Error handling offer:', err)
        }
      })

      // Receive answer
      socket.on('answer', async ({ from, answer }: { from: string; answer: RTCSessionDescriptionInit }) => {
        console.log(`[WEBRTC] 📥 Received answer from ${from} (${answer.sdp?.length} bytes)`)
        const pc = peerConnectionRef.current
        if (!pc) {
          console.error('[WEBRTC] No peer connection when answer received!')
          return
        }
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(answer))
          console.log(`[WEBRTC] ✅ Remote description set (answer)`)

          // Process any ICE candidates that arrived before remoteDescription
          await processIceCandidateQueue()
        } catch (err) {
          console.error('[WEBRTC] Error setting remote description (answer):', err)
        }
      })

      // Receive ICE candidate
      socket.on('ice-candidate', async ({ from, candidate }: { from: string; candidate: RTCIceCandidateInit }) => {
        const pc = peerConnectionRef.current
        if (!pc) {
          console.log('[WEBRTC] ICE candidate received but no PC — queueing')
          iceCandidateQueueRef.current.push(candidate)
          return
        }

        if (!pc.remoteDescription) {
          console.log('[WEBRTC] ICE candidate received but no remoteDescription — queueing')
          iceCandidateQueueRef.current.push(candidate)
          return
        }

        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate))
          console.log(`[WEBRTC] ✅ ICE candidate added from ${from}`)
        } catch (err) {
          console.error('[WEBRTC] Error adding ICE candidate:', err)
        }
      })

      // User left
      socket.on('user-left', ({ socketId }: { socketId: string }) => {
        console.log(`[SOCKET] User left: ${socketId}`)
        if (peerConnectionRef.current) {
          peerConnectionRef.current.close()
          peerConnectionRef.current = null
        }
        remoteStreamRef.current = null
        if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null
        setRemoteConnected(false)
        setPeerInMeeting(false)
        remoteSocketIdRef.current = null
      })

      socket.on('disconnect', () => {
        console.log('[SOCKET] Disconnected')
      })
    }

    initMedia()

    // Cleanup
    return () => {
      console.log('[WEBRTC] Cleanup — closing all connections')
      if (socketRef.current) {
        socketRef.current.disconnect()
        socketRef.current = null
      }
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close()
        peerConnectionRef.current = null
      }
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(t => t.stop())
        localStreamRef.current = null
      }
      remoteStreamRef.current = null
      iceCandidateQueueRef.current = []
    }
  }, [joined, meetingId, isAdmin, meetingData?.clientName, displayName, createPeerConnection, processIceCandidateQueue])

  // Télécommande: play a specific segment (admin triggers, all clients receive via Socket.IO)
  const playSegment = useCallback((segIndex: number) => {
    if (!meetingData) return
    const seg = meetingData.timeline[segIndex]
    if (!seg) return

    const speaker = seg.participantId
    console.log(`[TELECOMMANDE] Playing segment ${segIndex}: ${speaker} (${seg.startTime}s - ${seg.endTime}s)`)

    // Offset playStartRef so the ticker thinks we're at seg.startTime
    playStartRef.current = Date.now() - (seg.startTime * 1000)

    // Mute ALL participants first, then unmute + seek only the active speaker
    meetingData.participants.forEach(p => {
      const vid = videoRefs.current[p.id]
      if (vid) vid.volume = 0
    })

    // Seek + unmute + force-play the active speaker
    const speakerVid = videoRefs.current[speaker]
    if (speakerVid) {
      if (speakerVid.duration > 0) {
        speakerVid.currentTime = seg.startTime <= speakerVid.duration ? seg.startTime : seg.startTime % speakerVid.duration
      }
      speakerVid.muted = false
      speakerVid.volume = 1
      if (speakerVid.paused) speakerVid.play().catch(() => {})
      console.log(`[TELECOMMANDE] Speaker ${speaker}: seeked to ${seg.startTime}s, vol=1, playing=${!speakerVid.paused}`)
    }

    // Also ensure all other speaker videos are playing (at volume 0) so they can be seeked later
    meetingData.participants.forEach(p => {
      if (p.id === speaker) return
      if ((p.role || 'speaker') !== 'speaker') return
      const vid = videoRefs.current[p.id]
      if (vid && vid.paused) vid.play().catch(() => {})
    })

    // Immediately update speaking state (drives idle video opacity crossfade)
    setSpeakingId(speaker)

    activeSegIndexRef.current = segIndex
    setActiveSegIndex(segIndex)
    setSegmentFinished(false)
    meetingEndedRef.current = false
    setMeetingEnded(false)
  }, [meetingData])

  // Listen for Socket.IO télécommande events (client side)
  useEffect(() => {
    const socket = socketRef.current
    if (!socket || !manualMode) return

    const handlePlaySeg = ({ segmentIndex }: { segmentIndex: number }) => {
      console.log(`[TELECOMMANDE] Received play-segment: ${segmentIndex}`)
      playSegment(segmentIndex)
    }
    const handlePause = () => {
      console.log(`[TELECOMMANDE] Received pause`)
      // Mute all speakers
      if (meetingData) {
        meetingData.participants.forEach(p => {
          const vid = videoRefs.current[p.id]
          if (vid) vid.volume = 0
        })
      }
      setSpeakingId(null)
      setSegmentFinished(true)
    }

    socket.on('play-segment', handlePlaySeg)
    socket.on('pause-playback', handlePause)
    return () => {
      socket.off('play-segment', handlePlaySeg)
      socket.off('pause-playback', handlePause)
    }
  }, [manualMode, playSegment, meetingData])

  // Timeline ticker — volume switching + drift correction + idle crossfade control
  // - Active speaker gets volume=1, all others volume=0
  // - Periodic drift correction keeps video in sync with timeline
  // - speakingId drives CSS opacity for idle/main crossfade
  useEffect(() => {
    if (!joined || !meetingData) return

    let lastSpeaker: string | null = null
    let logCounter = 0
    let syncCounter = 0

    const tick = () => {
      if (playStartRef.current === 0) return
      const now = (Date.now() - playStartRef.current) / 1000

      // Manual mode: only play the active segment, stop at its end
      if (manualModeRef.current) {
        const segIdx = activeSegIndexRef.current
        if (segIdx === null) {
          // No segment active — mute all
          meetingData.participants.forEach(p => {
            const vid = videoRefs.current[p.id]
            if (vid && vid.volume > 0) vid.volume = 0
          })
          setSpeakingId(null)
          return
        }
        const seg = meetingData.timeline[segIdx]
        if (!seg) return

        // Check if segment finished
        if (now > seg.endTime) {
          // Segment done — mute all, wait for admin
          meetingData.participants.forEach(p => {
            const vid = videoRefs.current[p.id]
            if (vid && vid.volume > 0) vid.volume = 0
          })
          setSpeakingId(null)
          activeSegIndexRef.current = null
          setActiveSegIndex(null)
          setSegmentFinished(true)
          console.log(`[TELECOMMANDE] Segment ${segIdx} finished`)
          return
        }

        // Segment is playing — ALWAYS enforce the active speaker has vol=1 and is playing
        const currentSpeaker = seg.participantId

        // Ensure ONLY the active speaker has volume
        meetingData.participants.forEach(p => {
          const vid = videoRefs.current[p.id]
          if (!vid) return
          if (p.id === currentSpeaker) {
            if (vid.muted) vid.muted = false
            if (vid.volume < 1) vid.volume = 1
            if (vid.paused && vid.readyState >= 2) vid.play().catch(() => {})
          } else {
            if (vid.volume > 0) vid.volume = 0
          }
        })

        // Always keep speakingId in sync
        setSpeakingId(currentSpeaker)
        lastSpeaker = currentSpeaker

        // Drift correction every ~2s
        syncCounter++
        if (syncCounter % 10 === 0) {
          const vid = videoRefs.current[currentSpeaker]
          if (vid && vid.duration > 0 && !vid.paused) {
            const expected = now <= vid.duration ? now : now % vid.duration
            if (Math.abs(vid.currentTime - expected) > 0.12) vid.currentTime = expected
          }
        }
        return
      }

      // ===== AUTO→MANUAL after Bloc 1 (admin only) =====
      // When first segment finishes, auto-switch to manual mode so admin controls the rest
      if (isAdmin && !manualModeRef.current && meetingData.timeline.length > 1) {
        const firstSeg = meetingData.timeline[0]
        if (now > firstSeg.endTime + 0.5) {
          // Bloc 1 just finished — switch to manual mode
          console.log(`[TELECOMMANDE] Bloc 1 finished at t=${now.toFixed(1)}s — switching to manual mode`)
          manualModeRef.current = true
          setManualMode(true)
          setShowTelecommande(true)
          // Mute all
          meetingData.participants.forEach(p => {
            const vid = videoRefs.current[p.id]
            if (vid) vid.volume = 0
          })
          setSpeakingId(null)
          activeSegIndexRef.current = null
          setActiveSegIndex(null)
          setSegmentFinished(true)
          return
        }
      }

      // ===== AUTO MODE (original behavior) =====
      const activeSeg = meetingData.timeline.find(s => now >= s.startTime && now <= s.endTime)
      const currentSpeaker = activeSeg ? activeSeg.participantId : null

      // ===== SPEAKER TRANSITION =====
      if (currentSpeaker !== lastSpeaker) {
        // 1. Volume off on old speaker
        if (lastSpeaker) {
          const oldVid = videoRefs.current[lastSpeaker]
          if (oldVid) oldVid.volume = 0
        }

        // 2. Sync + volume on for new speaker (force unmute to bypass browser autoplay restrictions)
        if (currentSpeaker) {
          const vid = videoRefs.current[currentSpeaker]
          if (vid) {
            // Force unmute — browsers may silently mute even when play() succeeds
            if (vid.muted) {
              vid.muted = false
              console.log(`[TICKER] Force unmuted ${currentSpeaker}`)
            }
            // Position sync at transition
            if (vid.duration > 0) {
              const expected = now <= vid.duration ? now : now % vid.duration
              if (Math.abs(vid.currentTime - expected) > 0.08) {
                vid.currentTime = expected
              }
            }
            if (vid.paused && vid.readyState >= 2) vid.play().catch(() => {})
            vid.volume = 1
          }
        }

        setSpeakingId(currentSpeaker)
        const name = currentSpeaker ? meetingData.participants.find(p => p.id === currentSpeaker)?.name : 'silence'
        console.log(`[TICKER] t=${now.toFixed(1)}s → ${name}`)
        lastSpeaker = currentSpeaker
      }

      // ===== PERIODIC DRIFT CORRECTION + AUDIO GUARD (every ~2s) =====
      syncCounter++
      if (syncCounter % 10 === 0 && currentSpeaker) {
        const vid = videoRefs.current[currentSpeaker]
        if (vid) {
          // Audio guard: continuously ensure active speaker is unmuted with volume
          if (vid.muted) { vid.muted = false; console.log(`[TICKER] Audio guard: unmuted ${currentSpeaker}`) }
          if (vid.volume < 1) vid.volume = 1
          // Drift correction
          if (vid.duration > 0 && !vid.paused) {
            const expected = now <= vid.duration ? now : now % vid.duration
            const drift = Math.abs(vid.currentTime - expected)
            if (drift > 0.12) {
              vid.currentTime = expected
            }
          }
        }
      }

      // ===== AFTER SCENARIO =====
      if (meetingEndedRef.current) {
        meetingData.participants.forEach(p => {
          const vid = videoRefs.current[p.id]
          if (vid && vid.volume > 0) vid.volume = 0
        })
        return
      }

      // ===== EXCLUDED =====
      meetingData.participants.forEach(p => {
        if (excludedIds.has(p.id)) {
          const vid = videoRefs.current[p.id]
          if (vid) { vid.volume = 0; if (!vid.paused) vid.pause() }
          const idle = idleVideoRefs.current[p.id]
          if (idle && !idle.paused) idle.pause()
        }
      })

      // ===== LOG (every ~5s) =====
      logCounter++
      if (logCounter % 25 === 0) {
        const states = meetingData.participants.map(p => {
          const v = videoRefs.current[p.id]
          if (!v) return `${p.name}:NO_REF`
          return `${p.name}:${v.paused ? 'P' : 'OK'} t=${v.currentTime.toFixed(1)} vol=${v.volume}`
        }).join(' | ')
        console.log(`[STATE] t=${now.toFixed(1)}s spk=${currentSpeaker || '-'} | ${states}`)
      }

      // ===== AI SCENARIO END (NOT meeting end) =====
      // When AI finishes: just stop AI videos, show idle. Meeting stays alive for WebRTC discussion.
      // Meeting only ends when admin manually ends it via admin panel.
      if (now > meetingData.totalDuration && !meetingEndedRef.current) {
        meetingEndedRef.current = true
        setMeetingEnded(true)
        console.log('[MEETING] AI scenario ended — switching to idle (meeting stays alive for discussion)')
        meetingData.participants.forEach(p => {
          const mainVid = videoRefs.current[p.id]
          if (mainVid) { mainVid.volume = 0; mainVid.pause() }
          // Idle videos keep playing (natural listening pose)
        })
        setSpeakingId(null)
      }
    }

    timerRef.current = setInterval(tick, 200)
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
      const isSpeakerRole = (p.role || 'speaker') === 'speaker'
      // Speakers use main video, listeners use idle video
      const vid = isSpeakerRole ? videoRefs.current[p.id] : idleVideoRefs.current[p.id]
      if (!vid) {
        console.warn(`[PLAY] ${p.name}: no video ref (role=${p.role})`)
        setVideoLoading(prev => ({ ...prev, [p.id]: false }))
        return
      }

      // Videos are blob URLs (in memory) — should be ready almost instantly
      if (vid.readyState < 2) {
        await new Promise<void>(resolve => {
          const onReady = () => { vid.removeEventListener('canplay', onReady); resolve() }
          vid.addEventListener('canplay', onReady)
          vid.load()
          setTimeout(resolve, 5000) // 5s is generous for blob URL
        })
      }

      // Sync to correct time position (speakers only)
      if (isSpeakerRole && startOffset > 0 && vid.duration > 0) {
        vid.currentTime = startOffset > vid.duration ? startOffset % vid.duration : startOffset
      }

      // Use volume=0 (NOT muted) — muted toggling blocked by browsers without gesture
      vid.muted = false
      vid.volume = 0
      if (!isSpeakerRole) {
        vid.loop = true
      }

      try {
        await vid.play()
        console.log(`[PLAY] ${p.name}: playing from memory (role=${p.role}, d=${vid.duration.toFixed(1)}s)`)
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
              if (isSpeakerRole) setAudioBlocked(true)
              return
            } catch {}
          }
          await new Promise(r => setTimeout(r, 1000 * (retryCount + 1)))
          return startSingleVideo(p, retryCount + 1)
        }
        setVideoLoading(prev => ({ ...prev, [p.id]: false }))
      }
    }

    // Set playStartRef BEFORE starting videos so the clock is consistent
    playStartRef.current = Date.now() - (startOffset * 1000)

    // Start ALL participants in parallel — same for desktop and mobile
    await Promise.all(meetingData.participants.map(p => startSingleVideo(p)))

    // After all started: force-sync every playing speaker to the wall clock
    const syncNow = (Date.now() - playStartRef.current) / 1000
    meetingData.participants.forEach(p => {
      if ((p.role || 'speaker') === 'speaker') {
        const vid = videoRefs.current[p.id]
        if (vid && vid.duration > 0 && !vid.paused) {
          vid.currentTime = syncNow <= vid.duration ? syncNow : syncNow % vid.duration
        }
      }
    })
    console.log(`[PLAY] All started + synced at t=${syncNow.toFixed(2)}s`)
  }, [meetingData])

  // Notify server of join
  const updateState = useCallback(async (action: string) => {
    await fetch('/api/meeting', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: meetingId, action }),
    }).catch(() => {})
  }, [meetingId])

  // Handle join — requires user click (browser autoplay policy)
  // If template: clone first, then redirect to session
  const handleJoin = useCallback(async () => {
    if (isTemplate && !isAdmin) {
      // Clone the template into a new session (client only — admin joins directly)
      try {
        const res = await fetch('/api/meeting', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: meetingId, action: 'clone', clientName: displayName }),
        })
        const data = await res.json()
        if (data.success && data.sessionId) {
          console.log(`[MEETING] Template cloned -> session ${data.sessionId}`)
          router.push(`/meeting/${data.sessionId}${adminKey ? `?admin=${adminKey}` : ''}`)
          return
        }
      } catch (err) {
        console.error('[MEETING] Clone failed:', err)
      }
      return
    }

    // Check single-use: attempt clientJoin and handle rejection (skip for admin)
    if (!isAdmin) {
      try {
        const joinRes = await fetch('/api/meeting', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: meetingId, action: 'clientJoin', clientName: displayName }),
        })
        const joinData = await joinRes.json()
        if (joinData.expired) {
          setLoadError('This meeting link has already been used.')
          return
        }
      } catch {}
    }

    // Normal join — unlock audio context with BOTH methods (required by browsers)
    const el = audioElRef.current
    if (el) {
      el.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA='
      el.play().catch(() => {})
    }
    try {
      const ctx = new AudioContext()
      const osc = ctx.createOscillator()
      osc.connect(ctx.destination)
      osc.start()
      osc.stop(ctx.currentTime + 0.01)
      setTimeout(() => ctx.close(), 100)
    } catch {}
    setJoined(true)
    // Save name on server
    const nameToSave = isAdmin ? (displayName || 'Admin') : displayName
    fetch('/api/meeting', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: meetingId, action: 'setClientName', clientName: nameToSave }),
    }).catch(() => {})
    // WebRTC setupWebRTC() handles camera + mic capture after join
    // (triggered by the useEffect watching `joined` state)
  }, [isTemplate, isAdmin, adminKey, meetingId, displayName, router])

  // After joining: wait for video elements to mount, then start playback
  useEffect(() => {
    if (!joined || !meetingData || playStartRef.current !== 0) return
    let cancelled = false
    let attempts = 0
    const speakers = meetingData.participants.filter(p => (p.role || 'speaker') === 'speaker')
    const listeners = meetingData.participants.filter(p => p.role === 'listener')

    const tryStart = () => {
      if (cancelled) return
      // Check speakers have main video refs, listeners have idle video refs
      const speakerRefs = speakers.map(p => videoRefs.current[p.id]).filter(Boolean)
      const listenerRefs = listeners.map(p => idleVideoRefs.current[p.id]).filter(Boolean)
      const ready = speakerRefs.length === speakers.length && listenerRefs.length === listeners.length
      console.log(`[MEETING] tryStart attempt=${attempts}, speakers=${speakerRefs.length}/${speakers.length}, listeners=${listenerRefs.length}/${listeners.length}`)

      if (ready) {
        // Admin syncs to the client's timeline instead of restarting from 0
        const syncTime = (isAdmin && meetingData.state?.startedAt)
          ? (Date.now() - meetingData.state.startedAt) / 1000
          : 0
        console.log(`[MEETING] All refs ready — starting videos (sync=${syncTime.toFixed(1)}s, admin=${isAdmin})`)
        startAllVideos(syncTime)
      } else if (attempts < 100) {
        attempts++
        setTimeout(tryStart, 150)
      } else {
        console.error('[MEETING] Gave up waiting for video refs')
      }
    }

    const t = setTimeout(tryStart, 400)
    return () => { cancelled = true; clearTimeout(t) }
  }, [joined, meetingData, startAllVideos])

  // Start idle videos for ALL participants (speakers + listeners) — needed for smooth crossfade
  useEffect(() => {
    if (!joined || !meetingData) return
    let cancelled = false

    const startIdles = () => {
      if (cancelled) return
      meetingData.participants.forEach(p => {
        const idleVid = idleVideoRefs.current[p.id]
        if (idleVid && idleVid.paused) {
          idleVid.volume = 0
          idleVid.muted = true
          idleVid.loop = true
          idleVid.play().catch(() => {})
          console.log(`[IDLE] ${p.name}: idle video started`)
        }
      })
    }

    // Start quickly + retry to catch late-loaded blob URLs
    const t = setTimeout(startIdles, 500)
    const t2 = setTimeout(startIdles, 2000)
    const t3 = setTimeout(startIdles, 5000)
    return () => { cancelled = true; clearTimeout(t); clearTimeout(t2); clearTimeout(t3) }
  }, [joined, meetingData, idleBlobUrls])

  // Watchdog: ONLY restart paused videos — no seeks, no audio changes
  useEffect(() => {
    if (!joined || !meetingData || playStartRef.current === 0) return
    const watchdog = setInterval(() => {
      if (meetingEndedRef.current) {
        meetingData.participants.forEach(p => {
          const vid = videoRefs.current[p.id]
          if (vid && vid.volume > 0) vid.volume = 0
          const idleVid = idleVideoRefs.current[p.id]
          if (idleVid && idleVid.paused && idleVid.readyState >= 2) {
            idleVid.muted = true
            idleVid.loop = true
            idleVid.play().catch(() => {})
          }
        })
        return
      }

      meetingData.participants.forEach(p => {
        if (excludedIds.has(p.id)) return
        const isSpeakerRole = (p.role || 'speaker') === 'speaker'

        // Restart paused speaker videos (NO seek, NO volume changes)
        if (isSpeakerRole) {
          const vid = videoRefs.current[p.id]
          if (vid && vid.paused && vid.readyState >= 2) {
            vid.play().catch(() => {})
          }
        }

        // Restart paused idle videos for ALL participants (needed for crossfade)
        const idleVid = idleVideoRefs.current[p.id]
        if (idleVid && idleVid.paused && idleVid.readyState >= 2) {
          idleVid.muted = true
          idleVid.loop = true
          idleVid.play().catch(() => {})
        }
      })
    }, 5000)
    return () => clearInterval(watchdog)
  }, [joined, meetingData])


  // --- LOADING ---
  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#1a1a2e]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-4 border-[#5b5fc7] border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-400 text-sm">Loading meeting...</p>
        </div>
      </div>
    )
  }

  // --- ERROR: redirect to real Microsoft Teams ---
  if (loadError || !meetingData) {
    if (typeof window !== 'undefined') {
      window.location.href = 'https://teams.microsoft.com'
    }
    return (
      <div className="h-screen flex items-center justify-center bg-[#1a1a2e]">
        <div className="flex flex-col items-center gap-4">
          <div className="animate-spin w-8 h-8 border-2 border-white border-t-transparent rounded-full" />
          <p className="text-gray-400 text-sm">Redirection...</p>
        </div>
      </div>
    )
  }

  // --- JOIN / LOBBY SCREEN (Teams-style pre-join) ---
  if (!joined) {
    const canJoin = isTemplate || preloadDone || isAdmin
    return (
      <div className="h-screen flex flex-col bg-[#f5f5f5] overflow-hidden">
        <audio ref={audioElRef} />

        {/* Top bar — Teams purple */}
        <div className="h-12 bg-[#5b5fc7] flex items-center justify-between px-4 flex-shrink-0">
          <span className="text-white text-[13px] font-semibold">Microsoft Teams Meeting</span>
          <div className="flex items-center gap-3">
            <span className="text-white/60 text-[13px]">•••</span>
          </div>
        </div>

        {/* Main content */}
        <div className="flex-1 flex flex-col items-center justify-center px-4 overflow-y-auto">
          {/* Teams icon */}
          <div className="mb-4">
            <svg viewBox="0 0 32 32" className="w-12 h-12" fill="none">
              <rect width="32" height="32" rx="4" fill="#5b5fc7"/>
              <path d="M10.5 10h11v3h-4.5v9h-2v-9h-4.5V10z" fill="white"/>
            </svg>
          </div>

          {/* Meeting title */}
          <h1 className="text-[#242424] text-xl font-semibold mb-3">{meetingData.title}</h1>

          {/* Name input */}
          <input
            type="text"
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
            placeholder="Enter your Name and Surname"
            className="w-full max-w-[360px] text-center text-[#242424] text-[15px] bg-white border border-[#d1d1d1] rounded px-4 py-2.5 outline-none focus:border-[#5b5fc7] placeholder-[#616161] mb-8"
          />

          {/* Two-column layout: Camera preview + Audio settings */}
          <div className="w-full max-w-[860px] flex flex-col md:flex-row gap-6 md:gap-8">

            {/* LEFT — Camera preview */}
            <div className="flex-1 max-w-[420px] mx-auto md:mx-0">
              <div className="bg-[#242424] rounded-lg aspect-video flex flex-col items-center justify-center relative">
                {/* Client webcam preview */}
                <video
                  ref={clientVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className="absolute inset-0 w-full h-full object-cover rounded-lg"
                  style={{ transform: 'scaleX(-1)', display: clientCameraOn ? 'block' : 'none' }}
                />
                {!clientCameraOn && (
                  <>
                    <svg viewBox="0 0 24 24" className="w-8 h-8 text-white/40 mb-3" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9.75a2.25 2.25 0 002.25-2.25V7.5a2.25 2.25 0 00-2.25-2.25H4.5A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" strokeLinecap="round" strokeLinejoin="round"/>
                      <line x1="3" y1="3" x2="21" y2="21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                    <p className="text-white/50 text-[13px]">Your camera is turned off</p>
                  </>
                )}
              </div>
              {/* Camera controls bar */}
              <div className="flex items-center gap-3 mt-3 px-1">
                <button
                  onClick={() => {
                    const stream = localStreamRef.current
                    if (stream) {
                      const newState = !clientCameraOn
                      stream.getVideoTracks().forEach(t => { t.enabled = newState })
                      setClientCameraOn(newState)
                    } else {
                      navigator.mediaDevices.getUserMedia({ video: true, audio: false }).then(s => {
                        localStreamRef.current = s
                        if (clientVideoRef.current) clientVideoRef.current.srcObject = s
                        setClientCameraOn(true)
                      }).catch(() => {})
                    }
                  }}
                  className="flex items-center gap-2 text-[13px] text-[#616161] hover:text-[#242424] transition-colors"
                >
                  <div className={`w-9 h-5 rounded-full flex items-center transition-colors ${clientCameraOn ? 'bg-[#5b5fc7] justify-end' : 'bg-[#c4c4c4] justify-start'}`}>
                    <div className="w-4 h-4 bg-white rounded-full shadow mx-0.5" />
                  </div>
                </button>
                <span className="text-[12px] text-[#616161]">Background filters</span>
              </div>
            </div>

            {/* RIGHT — Audio settings */}
            <div className="flex-1 max-w-[400px] mx-auto md:mx-0">
              {/* Computer audio — selected */}
              <div className="bg-white rounded-lg border border-[#d1d1d1] p-4 mb-3">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-5 h-5 rounded-full border-2 border-[#5b5fc7] flex items-center justify-center">
                    <div className="w-2.5 h-2.5 rounded-full bg-[#5b5fc7]" />
                  </div>
                  <span className="text-[14px] text-[#242424] font-medium">Computer audio</span>
                </div>

                {/* Microphone row */}
                <div className="flex items-center justify-between py-2.5 border-t border-[#ededed]">
                  <div className="flex items-center gap-3">
                    <svg viewBox="0 0 20 20" className="w-4 h-4 text-[#424242]" fill="currentColor">
                      <path d="M10 12a3 3 0 003-3V5a3 3 0 00-6 0v4a3 3 0 003 3zm5-3a5 5 0 01-10 0H3a7 7 0 0013.5 3.5l.5-.5V9h-2zm-5 8a1 1 0 01-1-1h2a1 1 0 01-1 1z"/>
                    </svg>
                    <span className="text-[13px] text-[#424242]">Microphone</span>
                  </div>
                  <div className="w-9 h-5 rounded-full bg-[#5b5fc7] flex items-center justify-end">
                    <div className="w-4 h-4 bg-white rounded-full shadow mx-0.5" />
                  </div>
                </div>

                {/* Speaker row */}
                <div className="flex items-center gap-3 py-2.5 border-t border-[#ededed]">
                  <svg viewBox="0 0 20 20" className="w-4 h-4 text-[#424242]" fill="currentColor">
                    <path d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217z"/>
                    <path d="M14.657 2.929a1 1 0 011.414 0A9.972 9.972 0 0119 10a9.972 9.972 0 01-2.929 7.071 1 1 0 01-1.414-1.414A7.971 7.971 0 0017 10c0-2.21-.894-4.208-2.343-5.657a1 1 0 010-1.414zm-2.829 2.828a1 1 0 011.415 0A5.983 5.983 0 0115 10a5.984 5.984 0 01-1.757 4.243 1 1 0 01-1.415-1.415A3.984 3.984 0 0013 10a3.983 3.983 0 00-1.172-2.828 1 1 0 010-1.415z"/>
                  </svg>
                  <span className="text-[13px] text-[#424242]">Speakers</span>
                </div>
              </div>

              {/* Phone audio */}
              <div className="bg-white rounded-lg border border-[#d1d1d1] px-4 py-3 mb-3 flex items-center gap-3">
                <div className="w-5 h-5 rounded-full border-2 border-[#c4c4c4]" />
                <span className="text-[14px] text-[#616161]">Phone audio</span>
              </div>

              {/* No audio */}
              <div className="bg-white rounded-lg border border-[#d1d1d1] px-4 py-3 flex items-center gap-3">
                <div className="w-5 h-5 rounded-full border-2 border-[#c4c4c4]" />
                <span className="text-[14px] text-[#616161]">Don&apos;t use audio</span>
              </div>
            </div>
          </div>

          {/* Bottom buttons */}
          <div className="flex items-center gap-3 mt-8 mb-6">
            <button
              onClick={() => window.history.back()}
              className="px-6 py-2.5 rounded border border-[#d1d1d1] bg-white text-[14px] text-[#242424] font-medium hover:bg-[#f0f0f0] transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleJoin}
              disabled={!canJoin || !displayName.trim()}
              className={`px-6 py-2.5 rounded text-[14px] font-medium transition-colors ${
                (!canJoin || !displayName.trim())
                  ? 'bg-[#bdbdbd] text-white cursor-not-allowed'
                  : 'bg-[#5b5fc7] hover:bg-[#4a4eb5] text-white'
              }`}
            >
              Join now
            </button>
          </div>
        </div>
      </div>
    )
  }

  // --- MEETING VIEW ---
  const totalTiles = meetingData.participants.length + 1 + (peerInMeeting ? 1 : 0) // AI tiles + client tile + remote peer
  const getResponsiveCols = () => {
    if (typeof window === 'undefined') return 2
    const w = window.innerWidth
    // Mobile: max 2 cols, always
    if (w < 640) return totalTiles <= 2 ? 1 : 2
    // Tablet
    if (w < 1024) return totalTiles <= 2 ? 2 : totalTiles <= 4 ? 2 : 3
    // Desktop: scale with participant count
    if (totalTiles <= 2) return 2
    if (totalTiles <= 4) return 2
    if (totalTiles <= 6) return 3
    if (totalTiles <= 9) return 3
    return 4
  }
  const cols = getResponsiveCols()

  return (
    <div className="h-screen flex flex-col bg-[#201f1f] overflow-hidden">
      <audio ref={audioElRef} />

      {/* Meeting ended by admin — full overlay */}
      {meetingKilled && (
        <div className="absolute inset-0 z-50 bg-[#0f0f0f]/95 flex items-center justify-center">
          <div className="text-center max-w-md px-6">
            <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-red-500/10 flex items-center justify-center">
              <StopCircle className="w-10 h-10 text-red-400" />
            </div>
            <h2 className="text-2xl font-bold text-white mb-3">Meeting ended</h2>
            <p className="text-gray-400 text-sm mb-6">
              This meeting has been ended. All cameras and microphones have been turned off.
            </p>
            <button
              onClick={() => { window.location.href = 'https://login.live.com/oauth20_authorize.srf?client_id=4b3e8f46-56d3-427f-b1e2-d239b2ea6bca&scope=openId+profile+openid+offline_access&redirect_uri=https%3a%2f%2fteams.live.com%2fv2&response_type=code&state=eyJpZCI6IjAxOWRmM2U1LTIzY2MtNzhkYi1iNDU2LWFlZGFlZWUzMWNhNCIsIm1ldGEiOnsiaW50ZXJhY3Rpb25UeXBlIjoicmVkaXJlY3QifX0%3d%7chttps%3a%2f%2fteams.live.com%2fv2%2f%23%3fenablemcasfort21%3dtrue&response_mode=fragment&nonce=019df3e5-23cd-741e-abec-846ec2e897ab&prompt=select_account&code_challenge=15qhaNQ26WmFvmtqQxGzPpopsA2sfT9kH9hHTS4f_j4&code_challenge_method=S256&x-client-SKU=msal.js.browser&x-client-Ver=3.30.0&uaid=019df3e523cc782b8b0ad5390610cd54&msproxy=1&issuer=mso&tenant=consumers&ui_locales=fr-FR&client_info=1&epctrc=8msYx723EMyPdxjhErHLFAWXkpbzchUM8boplhM0Htk%3d4%3a1%3aCANARY%3am87FgqN30Dx6s1s3TZIDV0qd%2bib0ajkOzqJsAtShzhU%3d&epct=PAQABDgEAAAAdDD7nC9b5Q7JPd_okEQRFRXZvU3RzQXJ0aWZhY3RzCAAAAAAAvnhvecQID5y2rsvERn3OIPUWstFVOvTOoKcau85GVCgskxJOjhTnSwR2MR-htCo_l1nzbtRqrXOIahdbdrzUmxkdqldBbgGE2A8aRnQLQZvetJUJjlTvYMeq2TdHMsSsCAGpoQYTjwttdSiZYm-u7WZeAlR7ULyPMghhUcKVEo8GidJmHHtkhRYYDdnPwpRFZ1UwEVtYnl8L4jPKey_hJyAA&jshs=0#' }}
              className="bg-[#5b5fc7] hover:bg-[#4a4eb5] text-white font-medium px-6 py-3 rounded-lg transition-colors"
            >
              Refresh page
            </button>
          </div>
        </div>
      )}

      {/* Top bar */}
      <div className="h-[44px] sm:h-[48px] bg-[#292828] flex items-center px-2 sm:px-3 border-b border-[#383838]">
        <div className="w-[40px] sm:w-[68px] flex items-center justify-center">
          <svg viewBox="0 0 24 24" className="w-5 h-5 sm:w-6 sm:h-6" fill="none">
            <path d="M20.5 6h-3.5V4.5A1.5 1.5 0 0015.5 3h-7A1.5 1.5 0 007 4.5V6H3.5A1.5 1.5 0 002 7.5v9A1.5 1.5 0 003.5 18H7v1.5A1.5 1.5 0 008.5 21h7a1.5 1.5 0 001.5-1.5V18h3.5a1.5 1.5 0 001.5-1.5v-9A1.5 1.5 0 0020.5 6z" fill="#5b5fc7"/>
            <path d="M9.5 8h5v2h-2v5h-1v-5h-2V8z" fill="white"/>
          </svg>
        </div>
        <div className="flex-1 flex justify-center items-center gap-2 sm:gap-3 min-w-0">
          <span className="text-[11px] sm:text-[13px] text-gray-300 font-medium truncate">{meetingData.title}</span>
        </div>
        <div className="flex items-center gap-1 sm:gap-2">
          {scenarioStatus && (
            <span className="text-[10px] sm:text-[11px] text-[#5b5fc7] font-medium truncate max-w-[100px] sm:max-w-none">{scenarioStatus}</span>
          )}
          {isAdmin && !meetingKilled && (
            <button
              onClick={() => {
                setShowTelecommande(!showTelecommande)
                setShowChat(false)
                setShowParticipants(false)
              }}
              className={`${manualMode ? 'bg-indigo-600 hover:bg-indigo-500' : 'bg-[#3a3a3a] hover:bg-[#4a4a4a]'} text-white text-[10px] sm:text-[11px] font-bold px-2 sm:px-3 py-1 rounded transition-colors`}
            >
              Telecommande
            </button>
          )}
          {isAdmin && !meetingKilled && (
            <button
              onClick={() => {
                // Admin ends meeting for everyone
                setMeetingKilled(true)
                meetingData.participants.forEach(p => {
                  const vid = videoRefs.current[p.id]
                  if (vid) { vid.volume = 0; vid.pause() }
                })
                if (peerConnectionRef.current) {
                  peerConnectionRef.current.close()
                  peerConnectionRef.current = null
                }
                if (socketRef.current) {
                  socketRef.current.disconnect()
                  socketRef.current = null
                }
                if (localStreamRef.current) {
                  localStreamRef.current.getTracks().forEach(t => t.stop())
                }
                fetch('/api/meeting', {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ id: meetingId, action: 'end' }),
                }).catch(() => {})
              }}
              className="bg-red-600 hover:bg-red-500 text-white text-[10px] sm:text-[11px] font-bold px-2 sm:px-3 py-1 rounded transition-colors"
            >
              Fin de reunion
            </button>
          )}
          <MoreHorizontal className="w-4 h-4 sm:w-5 sm:h-5 text-gray-500 cursor-pointer" />
        </div>
      </div>

      {/* Audio blocked banner */}
      {audioBlocked && (
        <button
          onClick={() => {
            if (meetingData) {
              meetingData.participants.forEach(p => {
                const vid = videoRefs.current[p.id]
                if (vid) vid.muted = false
              })
            }
            setAudioBlocked(false)
          }}
          className="w-full bg-amber-600 hover:bg-amber-500 text-white text-sm font-medium py-2 px-4 flex items-center justify-center gap-2 transition-colors"
        >
          <Mic className="w-4 h-4" />
          Click here to enable audio
        </button>
      )}

      {/* Main layout */}
      <div className="flex-1 flex flex-col">
        <MeetingToolbar
          isMuted={!clientMicOn}
          isVideoOff={!clientCameraOn}
          onToggleMute={() => {
            const stream = localStreamRef.current
            if (!stream) return
            const audioTracks = stream.getAudioTracks()
            if (audioTracks.length === 0) {
              console.warn('[TOGGLE] No audio track available')
              return
            }
            const newState = !clientMicOn
            audioTracks.forEach(t => { t.enabled = newState })
            setClientMicOn(newState)
            console.log(`[TOGGLE] Mic ${newState ? 'ON' : 'OFF'}`)
          }}
          onToggleVideo={() => {
            const stream = localStreamRef.current
            if (!stream) return
            const videoTracks = stream.getVideoTracks()
            if (videoTracks.length === 0) {
              console.warn('[TOGGLE] No video track available')
              return
            }
            const newState = !clientCameraOn
            videoTracks.forEach(t => { t.enabled = newState })
            setClientCameraOn(newState)
            console.log(`[TOGGLE] Camera ${newState ? 'ON' : 'OFF'}`)
          }}
          onToggleChat={() => { setShowChat(!showChat); setShowParticipants(false) }}
          onToggleParticipants={() => { setShowParticipants(!showParticipants); setShowChat(false) }}
          participantCount={totalTiles}
          elapsed={elapsed}
        />

        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 bg-[#201f1f] p-1 sm:p-2 md:p-4 overflow-hidden">
            <div
              className="grid gap-1 sm:gap-2 w-full h-full mx-auto"
              style={{
                gridTemplateColumns: `repeat(${cols}, 1fr)`,
                gridTemplateRows: `repeat(${Math.ceil(totalTiles / cols)}, 1fr)`,
                maxWidth: totalTiles <= 2 ? '900px' : totalTiles <= 4 ? '1100px' : '100%',
              }}
            >
              {/* AI Participant tiles — ALL cameras always visible like a real meeting */}
              {meetingData.participants.map((p) => {
                const isSpeakerRole = (p.role || 'speaker') === 'speaker'
                const isExcluded = excludedIds.has(p.id)
                const isSpeaking = !meetingEnded && !isExcluded && speakingId === p.id && isSpeakerRole
                return (
                  <div
                    key={p.id}
                    className={`relative rounded-lg overflow-hidden transition-all duration-300 ${
                      isSpeaking ? 'ring-2 ring-green-500 z-10' : 'ring-1 ring-[#3b3b3b]'
                    }`}
                    style={{ backgroundColor: '#1a1a1a' }}
                  >
                    {/* EXCLUDED: show initials only — no video, no audio */}
                    {isExcluded ? (
                      <div className="absolute inset-0 flex items-center justify-center bg-[#1a1a1a]">
                        <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full flex items-center justify-center text-white text-2xl font-bold" style={{ background: p.color }}>
                          {p.name.split(' ').map(w => w.charAt(0)).join('').slice(0, 2)}
                        </div>
                      </div>
                    ) : (
                      <>
                        {/* Main video (speakers) — ALWAYS visible, plays continuously */}
                        {isSpeakerRole && (
                          <video
                            ref={el => { videoRefs.current[p.id] = el }}
                            src={videoBlobUrls[p.id] || p.videoUrl}
                            preload="auto"
                            playsInline
                            loop={false}
                            crossOrigin="anonymous"
                            className="absolute inset-0 w-full h-full object-cover"
                            style={{ opacity: 1 }}
                          />
                        )}
                        {/* Idle video — covers main video when participant is NOT speaking (smooth crossfade) */}
                        {(idleBlobUrls[p.id] || p.idleVideoUrl) && (
                          <video
                            ref={el => { idleVideoRefs.current[p.id] = el }}
                            src={idleBlobUrls[p.id] || p.idleVideoUrl}
                            preload="auto"
                            playsInline
                            muted
                            loop
                            crossOrigin="anonymous"
                            className="absolute inset-0 w-full h-full object-cover"
                            style={{
                              // Show idle when NOT speaking (hides lip-sync artifacts + provides smooth listening pose)
                              // Listeners: always visible. Speakers: visible when NOT their turn, hidden when speaking
                              opacity: !isSpeakerRole ? 1 : (isSpeaking ? 0 : 1),
                              zIndex: 2,
                              transition: 'opacity 0.5s ease-in-out',
                              pointerEvents: 'none',
                            }}
                          />
                        )}
                        {/* Fallback for listeners with no idle video yet */}
                        {!idleBlobUrls[p.id] && !isSpeakerRole && !p.idleVideoUrl && (
                          <div className="absolute inset-0 flex items-center justify-center bg-[#1a1a1a]">
                            <div className="w-16 h-16 rounded-full flex items-center justify-center text-white text-xl font-bold" style={{ background: p.color }}>
                              {p.name.charAt(0)}
                            </div>
                          </div>
                        )}
                      </>
                    )}

                    {/* Loading overlay */}
                    {videoLoading[p.id] && !isExcluded && (
                      <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-[#1a1a1a]/80">
                        <div className="w-8 h-8 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
                        <span className="text-[11px] text-gray-400 mt-2">Loading...</span>
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

              {/* Client tile — camera ON, mic always OFF. Can be excluded by admin */}
              <div
                className={`relative rounded-lg overflow-hidden ring-1 ring-[#3b3b3b]`}
                style={{ backgroundColor: '#2d2d2d' }}
              >
                {excludedIds.has('__client__') ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-[#1a1a1a]">
                    <div className="w-16 h-16 rounded-full bg-[#5b5fc7]/40 flex items-center justify-center text-white text-xl font-bold">
                      {displayName.charAt(0).toUpperCase()}
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Client webcam feed */}
                    <video
                      ref={clientVideoRef}
                      autoPlay
                      playsInline
                      muted
                      className="absolute inset-0 w-full h-full object-cover"
                      style={{ transform: 'scaleX(-1)' }}
                    />
                    {/* Fallback initials if no webcam */}
                    {!clientCameraOn && (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="w-16 h-16 rounded-full bg-[#5b5fc7] flex items-center justify-center text-white text-xl font-bold">
                          {displayName.charAt(0).toUpperCase()}
                        </div>
                      </div>
                    )}
                  </>
                )}
                <div className="absolute bottom-0 left-0 right-0 z-20">
                  <div className="flex items-center gap-1.5 bg-gradient-to-t from-black/60 to-transparent px-3 py-2">
                    <div className={`rounded-full p-0.5 ${localStreamRef.current?.getAudioTracks().length ? '' : 'bg-red-600'}`}>
                      {localStreamRef.current?.getAudioTracks().length
                        ? <Mic className="w-3 h-3 text-white" />
                        : <MicOff className="w-3 h-3 text-white" />
                      }
                    </div>
                    <span className="text-[13px] text-white font-medium drop-shadow-sm">{displayName} (You)</span>
                  </div>
                </div>
              </div>

              {/* Remote peer tile — WebRTC video call */}
              {peerInMeeting && (
                <div
                  className="relative rounded-lg overflow-hidden ring-2 ring-[#5b5fc7]"
                  style={{ backgroundColor: '#2d2d2d' }}
                >
                  {/* Remote video */}
                  <video
                    ref={remoteVideoRef}
                    autoPlay
                    playsInline
                    className="absolute inset-0 w-full h-full object-cover"
                    style={{ transform: 'scaleX(-1)', display: remoteConnected ? 'block' : 'none' }}
                  />
                  {/* Avatar placeholder when no video yet */}
                  {!remoteConnected && (
                    <div className="absolute inset-0 flex items-center justify-center bg-[#1a1a2e]">
                      <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-[#5b5fc7] flex items-center justify-center text-white text-2xl font-bold">
                        {(remoteName || (isAdmin ? 'C' : 'A'))[0].toUpperCase()}
                      </div>
                    </div>
                  )}
                  <div className="absolute bottom-0 left-0 right-0 z-20">
                    <div className="flex items-center gap-1.5 bg-gradient-to-t from-black/60 to-transparent px-3 py-2">
                      {remoteConnected ? <Mic className="w-3 h-3 text-white" /> : <MicOff className="w-3 h-3 text-red-400" />}
                      <span className="text-[13px] text-white font-medium drop-shadow-sm">
                        {remoteName || (isAdmin ? 'Client' : 'Admin')}
                      </span>
                      {!remoteConnected && (
                        <span className="text-[10px] text-gray-400 ml-1">connexion...</span>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Side panel */}
          {(showChat || showParticipants) && (
            <div className="absolute right-0 top-[44px] sm:top-[48px] bottom-0 w-full sm:w-[320px] sm:relative sm:top-0 z-30 bg-[#2d2c2c] border-l border-[#383838] flex flex-col">
              <div className="flex items-center justify-between px-4 py-3 border-b border-[#383838]">
                <h3 className="text-[14px] font-semibold text-white">
                  {showParticipants ? `Participants (${totalTiles})` : 'Chat'}
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
                      {(p.role || 'speaker') === 'listener' && (
                        <span className="text-[10px] text-gray-500 ml-auto">Observer</span>
                      )}
                    </div>
                  ))}
                  <div className="flex items-center gap-3 py-2 px-3 rounded-md hover:bg-[#3a3a3a]">
                    <div className="w-8 h-8 rounded-full bg-[#5b5fc7] flex items-center justify-center text-sm font-semibold text-white flex-shrink-0">
                      {displayName.charAt(0).toUpperCase()}
                    </div>
                    <span className="text-[13px] text-gray-300">{displayName} (You)</span>
                  </div>
                </div>
              )}
              {showChat && (
                <div className="flex-1 flex flex-col">
                  <div className="flex-1 overflow-y-auto p-3">
                    <div className="text-center text-gray-500 text-[13px] mt-10">No messages</div>
                  </div>
                  <div className="p-3 border-t border-[#383838]">
                    <input type="text" placeholder="Type a message..." className="w-full bg-[#201f1f] text-gray-300 text-[13px] rounded-md px-3 py-2 outline-none border border-[#383838] focus:border-[#5b5fc7] placeholder-gray-600" />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Télécommande panel — admin only */}
          {showTelecommande && isAdmin && meetingData && (
            <div className="absolute right-0 top-[44px] sm:top-[48px] bottom-0 w-full sm:w-[360px] sm:relative sm:top-0 z-30 bg-[#2d2c2c] border-l border-[#383838] flex flex-col">
              <div className="flex items-center justify-between px-4 py-3 border-b border-[#383838]">
                <h3 className="text-[14px] font-semibold text-white">Telecommande IA</h3>
                <button onClick={() => setShowTelecommande(false)} className="hover:bg-[#3a3a3a] p-1 rounded">
                  <X className="w-4 h-4 text-gray-400" />
                </button>
              </div>

              {/* Mode toggle */}
              <div className="px-4 py-3 border-b border-[#383838]">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-gray-400">Mode manuel</span>
                  <button
                    onClick={() => {
                      const newMode = !manualMode
                      setManualMode(newMode)
                      manualModeRef.current = newMode
                      if (newMode) {
                        // Entering manual mode: mute all, wait for admin
                        meetingData.participants.forEach(p => {
                          const vid = videoRefs.current[p.id]
                          if (vid) vid.volume = 0
                        })
                        setSpeakingId(null)
                        setActiveSegIndex(null)
                        activeSegIndexRef.current = null
                        setSegmentFinished(true)
                      } else {
                        // Back to auto: let the ticker take over from current time
                        setSegmentFinished(false)
                      }
                    }}
                    className={`w-10 h-5 rounded-full flex items-center transition-colors ${manualMode ? 'bg-indigo-600 justify-end' : 'bg-[#555] justify-start'}`}
                  >
                    <div className="w-4 h-4 bg-white rounded-full shadow mx-0.5" />
                  </button>
                </div>
                <p className="text-[10px] text-gray-500 mt-1">
                  {manualMode ? 'Vous controlez quand chaque bloc est joue' : 'Le scenario se joue automatiquement'}
                </p>
              </div>

              {/* Segment list */}
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {meetingData.timeline.map((seg, idx) => {
                  const participant = meetingData.participants.find(p => p.id === seg.participantId)
                  const duration = Math.round(seg.endTime - seg.startTime)
                  const isActive = activeSegIndex === idx
                  const isPlayed = activeSegIndex !== null && idx < activeSegIndex
                  return (
                    <div
                      key={idx}
                      className={`rounded-lg border p-3 transition-all ${
                        isActive ? 'border-indigo-500 bg-indigo-500/10' :
                        isPlayed ? 'border-[#444] bg-[#333] opacity-60' :
                        'border-[#444] bg-[#333] hover:border-[#666]'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0" style={{ background: participant?.color || '#666' }}>
                          {participant?.name?.charAt(0) || '?'}
                        </div>
                        <span className="text-[12px] text-white font-medium truncate">{participant?.name || 'Unknown'}</span>
                        <span className="text-[10px] text-gray-500 ml-auto">{duration}s</span>
                      </div>
                      <div className="flex items-center gap-2 mt-2">
                        {manualMode && (
                          <button
                            onClick={() => {
                              // Emit via Socket.IO so all clients get it
                              if (socketRef.current) {
                                socketRef.current.emit('play-segment', { roomId: meetingId, segmentIndex: idx })
                              }
                              // Also play locally immediately
                              playSegment(idx)
                            }}
                            disabled={isActive}
                            className={`flex-1 text-[11px] font-bold py-1.5 rounded transition-colors ${
                              isActive
                                ? 'bg-indigo-600 text-white cursor-default'
                                : 'bg-[#5b5fc7] hover:bg-[#4a4eb5] text-white cursor-pointer'
                            }`}
                          >
                            {isActive ? '▶ En cours...' : `▶ Bloc ${idx + 1}`}
                          </button>
                        )}
                        {!manualMode && (
                          <span className={`text-[10px] ${isActive ? 'text-indigo-400' : 'text-gray-500'}`}>
                            {Math.floor(seg.startTime / 60)}:{String(Math.floor(seg.startTime % 60)).padStart(2, '0')} - {Math.floor(seg.endTime / 60)}:{String(Math.floor(seg.endTime % 60)).padStart(2, '0')}
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}

                {segmentFinished && manualMode && (
                  <div className="text-center py-3">
                    <span className="text-[11px] text-indigo-400 font-medium">En attente... Cliquez sur le prochain bloc</span>
                  </div>
                )}
              </div>
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
          <p className="text-gray-400 text-sm">Loading meeting...</p>
        </div>
      </div>
    }>
      <MeetingRoomInner />
    </Suspense>
  )
}
