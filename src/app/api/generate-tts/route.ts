import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export const runtime = 'nodejs'

const ELEVENLABS_KEY = process.env.ELEVENLABS_API_KEY || ''
const PCM_RATE = 16000

// Generate TTS audio only — returns PCM file path + duration
export async function POST(request: NextRequest) {
  if (!ELEVENLABS_KEY) return NextResponse.json({ error: 'ELEVENLABS_API_KEY not set' }, { status: 500 })

  try {
    const { text, voiceId, filename } = await request.json()
    if (!text || !voiceId) return NextResponse.json({ error: 'Missing text or voiceId' }, { status: 400 })

    console.log(`[TTS] Generating PCM for: "${text.slice(0, 50)}..." (voice=${voiceId})`)

    const ttsRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=pcm_16000`, {
      method: 'POST',
      headers: {
        'Accept': 'application/octet-stream',
        'Content-Type': 'application/json',
        'xi-api-key': ELEVENLABS_KEY,
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: { stability: 0.65, similarity_boost: 0.78, style: 0.15, use_speaker_boost: true },
      }),
    })

    if (!ttsRes.ok) {
      const err = await ttsRes.text()
      return NextResponse.json({ error: `ElevenLabs error: ${err.slice(0, 200)}` }, { status: 500 })
    }

    const rawPcm = Buffer.from(await ttsRes.arrayBuffer())
    const durationSec = rawPcm.length / (PCM_RATE * 2)

    // Save PCM to file
    const outDir = path.join(process.cwd(), 'public', 'audio-temp')
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })
    const fname = filename || `tts-${Date.now()}.pcm`
    fs.writeFileSync(path.join(outDir, fname), rawPcm)

    console.log(`[TTS] Saved: ${fname} (${(rawPcm.length / 1024).toFixed(0)} KB, ${durationSec.toFixed(1)}s)`)

    return NextResponse.json({
      success: true,
      pcmPath: `/audio-temp/${fname}`,
      duration: durationSec,
      sizeBytes: rawPcm.length,
    })
  } catch (err: any) {
    console.error('[TTS] Error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
