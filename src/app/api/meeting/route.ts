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
  excludedParticipants: string[] // participant IDs that have been kicked
  ended: boolean // true once meeting is definitively over
  isTemplate?: boolean // true = original generated meeting (link to share)
  templateId?: string // if this is a session, points to the original template
  clientName?: string // name the client entered when joining
  singleUse?: boolean // true = link can only be used once
  consumed?: boolean // true = someone already joined this single-use link
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
    title: body.title || "Prime Minister's Coordination Meeting",
    createdAt: Date.now(),
    adminKey,
    participants: body.participants || [],
    timeline: body.timeline || [],
    totalDuration: body.totalDuration || 0,
    excludedParticipants: [],
    ended: false,
    isTemplate: true, // original generated meeting = template
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

// GET: retrieve meeting data by ID, or list all meetings if no ID
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')

  // List all meetings (for admin page)
  if (!id || id === 'list') {
    ensureDir()
    const files = fs.readdirSync(MEETINGS_DIR).filter(f => f.endsWith('.json'))
    const meetings = files.map(f => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(MEETINGS_DIR, f), 'utf-8')) as MeetingData
        return {
          id: data.id,
          title: data.title,
          createdAt: data.createdAt,
          participantCount: data.participants.length,
          participants: data.participants.map(p => ({ id: p.id, name: p.name, color: p.color, role: p.role })),
          timeline: data.timeline || [],
          excludedParticipants: data.excludedParticipants || [],
          ended: data.ended || false,
          isTemplate: data.isTemplate || false,
          templateId: data.templateId,
          clientName: data.clientName,
          totalDuration: data.totalDuration,
          state: data.state,
          adminKey: data.adminKey,
        }
      } catch { return null }
    }).filter(Boolean)
    // Sort newest first
    meetings.sort((a: any, b: any) => b.createdAt - a.createdAt)
    return NextResponse.json({ success: true, meetings })
  }

  const meeting = loadMeeting(id)
  if (!meeting) {
    return NextResponse.json({ error: 'Meeting not found' }, { status: 404 })
  }
  // Backfill for older meetings missing new fields
  if (!meeting.excludedParticipants) meeting.excludedParticipants = []
  if (meeting.ended === undefined) meeting.ended = false
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

  // Backfill for older meetings
  if (!meeting.excludedParticipants) meeting.excludedParticipants = []
  if (meeting.ended === undefined) meeting.ended = false

  switch (action) {
    case 'clientJoin':
      // Enforce single-use: if already consumed, reject
      if (meeting.singleUse && meeting.consumed) {
        return NextResponse.json({ error: 'This meeting link has already been used.', expired: true }, { status: 403 })
      }
      meeting.state.clientJoined = true
      if (!meeting.state.started) {
        meeting.state.started = true
        meeting.state.startedAt = Date.now()
      }
      // Save client name if provided
      if (body.clientName) meeting.clientName = body.clientName
      // Mark single-use session as consumed
      if (meeting.singleUse) {
        meeting.consumed = true
      }
      console.log(`[MEETING] ${id}: Client joined${meeting.singleUse ? ' (single-use consumed)' : ''}`)
      break
    case 'clientLeave':
      meeting.state.clientJoined = false
      console.log(`[MEETING] ${id}: Client left`)
      break
    case 'kick': {
      const participantId = body.participantId
      if (!participantId) return NextResponse.json({ error: 'Missing participantId' }, { status: 400 })
      if (!meeting.excludedParticipants.includes(participantId)) {
        meeting.excludedParticipants.push(participantId)
      }
      const pName = meeting.participants.find(p => p.id === participantId)?.name || participantId
      console.log(`[MEETING] ${id}: Kicked ${pName}`)
      break
    }
    case 'restore': {
      const participantId = body.participantId
      if (!participantId) return NextResponse.json({ error: 'Missing participantId' }, { status: 400 })
      meeting.excludedParticipants = meeting.excludedParticipants.filter((pid: string) => pid !== participantId)
      const pName = meeting.participants.find(p => p.id === participantId)?.name || participantId
      console.log(`[MEETING] ${id}: Restored ${pName}`)
      break
    }
    case 'end':
      meeting.ended = true
      console.log(`[MEETING] ${id}: Meeting ended by admin`)
      break
    case 'clone': {
      // Create a new session from a template meeting
      const clientName = body.clientName || ''
      const singleUse = body.singleUse || false
      const sessionId = crypto.randomBytes(4).toString('hex')
      const session: MeetingData = {
        ...JSON.parse(JSON.stringify(meeting)),
        id: sessionId,
        createdAt: Date.now(),
        adminKey: meeting.adminKey,
        isTemplate: false,
        templateId: meeting.id,
        clientName: clientName || undefined,
        singleUse,
        consumed: false,
        excludedParticipants: [],
        ended: false,
        state: { started: false, startedAt: null, clientJoined: false },
      }
      saveMeeting(session)
      console.log(`[MEETING] Cloned ${id} -> session ${sessionId}${singleUse ? ' (single-use)' : ''} for ${clientName || 'TBD'}`)
      return NextResponse.json({ success: true, sessionId })
    }
    case 'bulkClone': {
      // Create N single-use sessions from a template
      const count = body.count || 5
      const sessionIds: string[] = []
      for (let i = 0; i < count; i++) {
        const sid = crypto.randomBytes(4).toString('hex')
        const session: MeetingData = {
          ...JSON.parse(JSON.stringify(meeting)),
          id: sid,
          createdAt: Date.now(),
          adminKey: meeting.adminKey,
          isTemplate: false,
          templateId: meeting.id,
          clientName: undefined,
          singleUse: true,
          consumed: false,
          excludedParticipants: [],
          ended: false,
          state: { started: false, startedAt: null, clientJoined: false },
        }
        saveMeeting(session)
        sessionIds.push(sid)
      }
      console.log(`[MEETING] Bulk cloned ${id} -> ${count} single-use sessions: ${sessionIds.join(', ')}`)
      return NextResponse.json({ success: true, sessionIds })
    }
    case 'setClientName':
      meeting.clientName = body.clientName || 'Client'
      console.log(`[MEETING] ${id}: Client name set to ${meeting.clientName}`)
      break
    default:
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
  }

  saveMeeting(meeting)
  return NextResponse.json({ success: true, state: meeting.state })
}
