import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

export interface MeetingData {
  id: string
  title: string
  createdAt: number
  adminKey: string
  participants: { id: string; name: string; color: string; videoUrl: string; idleVideoUrl?: string; role?: 'speaker' | 'listener' }[]
  timeline: { participantId: string; startTime: number; endTime: number }[]
  totalDuration: number
  state: {
    started: boolean
    startedAt: number | null
    clientJoined: boolean
  }
}

// Persist meetings to disk so they survive hot-reloads
const MEETINGS_DIR = path.join(process.cwd(), 'public', 'meetings')

function ensureDir() {
  if (!fs.existsSync(MEETINGS_DIR)) fs.mkdirSync(MEETINGS_DIR, { recursive: true })
}

function saveMeeting(meeting: MeetingData) {
  ensureDir()
  fs.writeFileSync(path.join(MEETINGS_DIR, `${meeting.id}.json`), JSON.stringify(meeting))
}

function loadMeeting(id: string): MeetingData | null {
  const filePath = path.join(MEETINGS_DIR, `${id}.json`)
  if (!fs.existsSync(filePath)) return null
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  } catch {
    return null
  }
}

// POST: create a new meeting room
export async function POST(request: NextRequest) {
  const body = await request.json()
  const id = crypto.randomBytes(4).toString('hex') // 8-char hex ID
  const adminKey = crypto.randomBytes(8).toString('hex') // 16-char secret for admin
  const meeting: MeetingData = {
    id,
    title: body.title || 'Reunion IA',
    createdAt: Date.now(),
    adminKey,
    participants: body.participants || [],
    timeline: body.timeline || [],
    totalDuration: body.totalDuration || 0,
    state: {
      started: false,
      startedAt: null,
      clientJoined: false,
    },
  }
  saveMeeting(meeting)
  console.log(`[MEETING] Created room ${id} (adminKey=${adminKey}) with ${meeting.participants.length} participants, ${meeting.timeline.length} segments, ${meeting.totalDuration.toFixed(1)}s`)
  return NextResponse.json({ success: true, meetingId: id, adminKey })
}

// GET: retrieve meeting data by ID
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  if (!id) {
    return NextResponse.json({ error: 'Missing meeting id' }, { status: 400 })
  }
  const meeting = loadMeeting(id)
  if (!meeting) {
    return NextResponse.json({ error: 'Meeting not found' }, { status: 404 })
  }
  const safeData = { ...meeting, adminKey: undefined }
  return NextResponse.json({ success: true, meeting: safeData })
}

// PATCH: update meeting state (join/leave/start)
export async function PATCH(request: NextRequest) {
  const body = await request.json()
  const { id, action } = body
  if (!id || !action) {
    return NextResponse.json({ error: 'Missing id or action' }, { status: 400 })
  }
  const meeting = loadMeeting(id)
  if (!meeting) {
    return NextResponse.json({ error: 'Meeting not found' }, { status: 404 })
  }

  switch (action) {
    case 'clientJoin':
      meeting.state.clientJoined = true
      if (!meeting.state.started) {
        meeting.state.started = true
        meeting.state.startedAt = Date.now()
      }
      console.log(`[MEETING] ${id}: Client joined`)
      break
    case 'clientLeave':
      meeting.state.clientJoined = false
      console.log(`[MEETING] ${id}: Client left`)
      break
    default:
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
  }

  saveMeeting(meeting)
  return NextResponse.json({ success: true, state: meeting.state })
}
