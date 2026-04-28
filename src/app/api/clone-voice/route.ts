import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 120

const ELEVENLABS_KEY = process.env.ELEVENLABS_API_KEY || ''

// POST: clone a voice from an uploaded audio sample
export async function POST(request: NextRequest) {
  if (!ELEVENLABS_KEY) return NextResponse.json({ error: 'ELEVENLABS_API_KEY not set' }, { status: 500 })

  try {
    const formData = await request.formData()
    const audioFile = formData.get('audio') as File | null
    const name = (formData.get('name') as string) || `Clone-${Date.now()}`

    if (!audioFile) {
      return NextResponse.json({ error: 'Missing audio file' }, { status: 400 })
    }

    console.log(`[CLONE] Cloning voice "${name}" from ${audioFile.name} (${(audioFile.size / 1024).toFixed(0)} KB)`)

    // Send to ElevenLabs Instant Voice Clone API
    const elForm = new FormData()
    elForm.append('name', name)
    elForm.append('files', audioFile, audioFile.name)
    elForm.append('description', `Cloned voice for ${name}`)

    const res = await fetch('https://api.elevenlabs.io/v1/voices/add', {
      method: 'POST',
      headers: {
        'xi-api-key': ELEVENLABS_KEY,
      },
      body: elForm,
    })

    if (!res.ok) {
      const errText = await res.text()
      console.error(`[CLONE] ElevenLabs error ${res.status}:`, errText.slice(0, 300))
      return NextResponse.json({ error: `ElevenLabs clone error: ${errText.slice(0, 200)}` }, { status: 500 })
    }

    const data = await res.json()
    const voiceId = data.voice_id

    if (!voiceId) {
      return NextResponse.json({ error: 'No voice_id returned from ElevenLabs' }, { status: 500 })
    }

    console.log(`[CLONE] Success! Voice "${name}" → voiceId=${voiceId}`)

    return NextResponse.json({
      success: true,
      voiceId,
      name,
    })
  } catch (err: any) {
    console.error('[CLONE] Error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// DELETE: remove a cloned voice
export async function DELETE(request: NextRequest) {
  if (!ELEVENLABS_KEY) return NextResponse.json({ error: 'ELEVENLABS_API_KEY not set' }, { status: 500 })

  try {
    const { voiceId } = await request.json()
    if (!voiceId) return NextResponse.json({ error: 'Missing voiceId' }, { status: 400 })

    const res = await fetch(`https://api.elevenlabs.io/v1/voices/${voiceId}`, {
      method: 'DELETE',
      headers: { 'xi-api-key': ELEVENLABS_KEY },
    })

    if (!res.ok) {
      const errText = await res.text()
      return NextResponse.json({ error: `Delete failed: ${errText.slice(0, 200)}` }, { status: 500 })
    }

    console.log(`[CLONE] Deleted voice ${voiceId}`)
    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
