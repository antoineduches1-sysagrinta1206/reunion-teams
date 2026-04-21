import { NextRequest, NextResponse } from 'next/server'

interface Command {
  type: string
  participantId?: string
  text?: string
  videoFile?: string
  participants?: unknown[]
  sequence?: { participantId: string; videoFile: string }[]
  idleVideos?: Record<string, string>
  timestamp: number
}

// In-memory command queue
let pendingCommands: Command[] = []

// Admin POST: push a command
export async function POST(request: NextRequest) {
  const body = await request.json()
  const cmd: Command = { ...body, timestamp: Date.now() }
  pendingCommands.push(cmd)
  console.log(`[CMD POST] type=${cmd.type} pid=${cmd.participantId} text="${cmd.text?.slice(0, 30)}" queue=${pendingCommands.length}`)
  return NextResponse.json({ ok: true, queued: pendingCommands.length })
}

// Meeting GET: poll and consume commands
export async function GET() {
  const cmds = [...pendingCommands]
  if (cmds.length > 0) {
    console.log(`[CMD GET] delivering ${cmds.length} commands`)
  }
  pendingCommands = []
  return NextResponse.json({ commands: cmds })
}

// Allow CORS
export async function OPTIONS() {
  return new NextResponse(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  })
}
