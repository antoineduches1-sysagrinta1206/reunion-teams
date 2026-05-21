import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export const runtime = 'nodejs'

const SIGNALS_DIR = path.join(process.cwd(), 'data', 'signals')

function ensureDir() {
  if (!fs.existsSync(SIGNALS_DIR)) fs.mkdirSync(SIGNALS_DIR, { recursive: true })
}

function getSignalPath(meetingId: string) {
  return path.join(SIGNALS_DIR, `${meetingId}.json`)
}

interface SignalData {
  meetingId: string
  // Client's offer (client -> admin)
  clientOffer?: RTCSessionDescriptionInit | null
  // Admin's answer (admin -> client)
  adminAnswer?: RTCSessionDescriptionInit | null
  // ICE candidates from client
  clientCandidates: RTCIceCandidateInit[]
  // ICE candidates from admin
  adminCandidates: RTCIceCandidateInit[]
  // Timestamps for cleanup
  updatedAt: number
}

function loadSignal(meetingId: string): SignalData {
  ensureDir()
  const p = getSignalPath(meetingId)
  if (fs.existsSync(p)) {
    return JSON.parse(fs.readFileSync(p, 'utf-8'))
  }
  return {
    meetingId,
    clientOffer: null,
    adminAnswer: null,
    clientCandidates: [],
    adminCandidates: [],
    updatedAt: Date.now(),
  }
}

function saveSignal(data: SignalData) {
  ensureDir()
  data.updatedAt = Date.now()
  fs.writeFileSync(getSignalPath(data.meetingId), JSON.stringify(data))
}

// GET: retrieve current signaling state for a meeting
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const meetingId = searchParams.get('meetingId')
  const role = searchParams.get('role') // 'client' or 'admin'

  if (!meetingId || !role) {
    return NextResponse.json({ error: 'Missing meetingId or role' }, { status: 400 })
  }

  const signal = loadSignal(meetingId)

  // Return only what this role needs to receive
  if (role === 'client') {
    return NextResponse.json({
      adminAnswer: signal.adminAnswer,
      adminCandidates: signal.adminCandidates,
      hasAdmin: !!signal.adminAnswer,
    })
  } else {
    return NextResponse.json({
      clientOffer: signal.clientOffer,
      clientCandidates: signal.clientCandidates,
      hasClient: !!signal.clientOffer,
    })
  }
}

// POST: send signaling data
export async function POST(request: NextRequest) {
  const body = await request.json()
  const { meetingId, role, type, data } = body

  if (!meetingId || !role || !type) {
    return NextResponse.json({ error: 'Missing meetingId, role, or type' }, { status: 400 })
  }

  const signal = loadSignal(meetingId)

  switch (type) {
    case 'offer':
      // Store/update the client offer (vanilla ICE: candidates are embedded in SDP)
      signal.clientOffer = data
      console.log(`[SIGNAL] ${meetingId}: Client offer stored (${data?.sdp?.length || 0} bytes)`)
      break
    case 'answer':
      signal.adminAnswer = data
      console.log(`[SIGNAL] ${meetingId}: Admin answer stored`)
      break
    case 'candidate':
      if (role === 'client') {
        signal.clientCandidates.push(data)
      } else {
        signal.adminCandidates.push(data)
      }
      break
    case 'reset':
      // Reset all signaling for this meeting
      signal.clientOffer = null
      signal.adminAnswer = null
      signal.clientCandidates = []
      signal.adminCandidates = []
      console.log(`[SIGNAL] ${meetingId}: Reset`)
      break
    default:
      return NextResponse.json({ error: `Unknown type: ${type}` }, { status: 400 })
  }

  saveSignal(signal)
  return NextResponse.json({ success: true })
}
