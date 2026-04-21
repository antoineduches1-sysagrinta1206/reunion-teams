#!/usr/bin/env node
/**
 * Pipeline: scenario.json → ElevenLabs audio → OmniHuman 1.5 video
 *
 * Usage:
 *   node scripts/generate-videos.mjs
 *   node scripts/generate-videos.mjs --segment s01    (generate only one segment)
 *   node scripts/generate-videos.mjs --audio-only     (generate audio only)
 *
 * Requirements:
 *   - .env.local with ELEVENLABS_API_KEY and REPLICATE_API_TOKEN
 *   - Photos in public/photos/ named: p1.jpg, p2.jpg, p3.jpg, p4.jpg
 *   - scenario.json in scripts/
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

// ─── Load env ───
function loadEnv() {
  const envPath = path.join(ROOT, '.env.local')
  if (!fs.existsSync(envPath)) throw new Error('.env.local not found')
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n')
  for (const line of lines) {
    const m = line.match(/^([A-Z_]+)=(.+)$/)
    if (m) process.env[m[1]] = m[2].trim()
  }
}
loadEnv()

const ELEVENLABS_KEY = process.env.ELEVENLABS_API_KEY
const REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN

if (!ELEVENLABS_KEY) throw new Error('ELEVENLABS_API_KEY not set in .env.local')
if (!REPLICATE_TOKEN) throw new Error('REPLICATE_API_TOKEN not set in .env.local')

// ─── Dirs ───
const AUDIO_DIR = path.join(ROOT, 'public', 'audio-scenario')
const VIDEO_DIR = path.join(ROOT, 'public', 'videos-scenario')
fs.mkdirSync(AUDIO_DIR, { recursive: true })
fs.mkdirSync(VIDEO_DIR, { recursive: true })

// ─── Load scenario ───
const scenario = JSON.parse(fs.readFileSync(path.join(__dirname, 'scenario.json'), 'utf-8'))

// ─── CLI args ───
const args = process.argv.slice(2)
const onlySegment = args.includes('--segment') ? args[args.indexOf('--segment') + 1] : null
const audioOnly = args.includes('--audio-only')

// ─── Step 1: Generate audio via ElevenLabs ───
async function generateAudio(segment) {
  const outPath = path.join(AUDIO_DIR, `${segment.id}.mp3`)

  // Skip if already exists
  if (fs.existsSync(outPath)) {
    console.log(`  ✅ Audio exists: ${segment.id}.mp3`)
    return outPath
  }

  const participant = scenario.participants[segment.speaker]
  const voiceId = participant.voiceId

  console.log(`  🎙️  Generating audio for ${segment.id} (${participant.role})...`)
  console.log(`     Voice: ${voiceId} | Text: "${segment.text.slice(0, 60)}..."`)

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'Accept': 'audio/mpeg',
      'Content-Type': 'application/json',
      'xi-api-key': ELEVENLABS_KEY,
    },
    body: JSON.stringify({
      text: segment.text,
      model_id: 'eleven_multilingual_v2',
      voice_settings: {
        stability: 0.45,
        similarity_boost: 0.78,
        style: 0.35,
        use_speaker_boost: true,
      },
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`ElevenLabs error ${res.status}: ${err}`)
  }

  const buffer = Buffer.from(await res.arrayBuffer())
  fs.writeFileSync(outPath, buffer)
  console.log(`  ✅ Audio saved: ${segment.id}.mp3 (${(buffer.length / 1024).toFixed(0)} KB)`)
  return outPath
}

// ─── Step 2: Generate video via OmniHuman 1.5 on Replicate ───
async function generateVideo(segment, audioPath) {
  const outPath = path.join(VIDEO_DIR, `${segment.id}.mp4`)

  // Skip if already exists
  if (fs.existsSync(outPath)) {
    console.log(`  ✅ Video exists: ${segment.id}.mp4`)
    return outPath
  }

  // Photo for participant
  const photoPath = path.join(ROOT, 'public', 'photos', `${segment.speaker}.jpg`)
  if (!fs.existsSync(photoPath)) {
    console.log(`  ⚠️  SKIP video: No photo at ${photoPath}`)
    console.log(`     → Place a webcam-style photo named ${segment.speaker}.jpg in public/photos/`)
    return null
  }

  // Convert photo + audio to base64 data URIs
  const photoB64 = `data:image/jpeg;base64,${fs.readFileSync(photoPath).toString('base64')}`
  const audioB64 = `data:audio/mpeg;base64,${fs.readFileSync(audioPath).toString('base64')}`

  const participant = scenario.participants[segment.speaker]
  console.log(`  🎬 Generating video for ${segment.id} (${participant.role})...`)
  console.log(`     Prompt: "${segment.prompt.slice(0, 80)}..."`)

  // Create prediction via model endpoint (no version hash needed)
  const createRes = await fetch('https://api.replicate.com/v1/models/bytedance/omni-human-1.5/predictions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${REPLICATE_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input: {
        image: photoB64,
        audio: audioB64,
        prompt: segment.prompt,
      },
    }),
  })

  if (!createRes.ok) {
    const err = await createRes.text()
    throw new Error(`Replicate create error ${createRes.status}: ${err}`)
  }

  const prediction = await createRes.json()
  console.log(`  ⏳ Prediction ${prediction.id} created, polling...`)

  // Poll for completion (max 10 min)
  const pollUrl = prediction.urls?.get || `https://api.replicate.com/v1/predictions/${prediction.id}`
  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 5000))

    const pollRes = await fetch(pollUrl, {
      headers: { 'Authorization': `Bearer ${REPLICATE_TOKEN}` },
    })
    const status = await pollRes.json()

    if (status.status === 'succeeded') {
      const outputUrl = Array.isArray(status.output) ? status.output[0] : status.output
      console.log(`  📥 Downloading video...`)

      const videoRes = await fetch(outputUrl)
      const videoBuffer = Buffer.from(await videoRes.arrayBuffer())
      fs.writeFileSync(outPath, videoBuffer)
      console.log(`  ✅ Video saved: ${segment.id}.mp4 (${(videoBuffer.length / 1024 / 1024).toFixed(1)} MB)`)
      return outPath
    }

    if (status.status === 'failed' || status.status === 'canceled') {
      console.error(`  ❌ Video generation failed: ${status.error}`)
      return null
    }

    if (i % 6 === 0) {
      console.log(`     ... ${status.status} (${i * 5}s)`)
    }
  }

  console.error(`  ❌ Timeout waiting for video`)
  return null
}

// ─── Main ───
async function main() {
  console.log('═══════════════════════════════════════════════════')
  console.log('  🎬 Video Generation Pipeline')
  console.log(`  Scenario: ${scenario.title}`)
  console.log(`  Segments: ${scenario.sequence.length}`)
  console.log('═══════════════════════════════════════════════════\n')

  const segments = onlySegment
    ? scenario.sequence.filter(s => s.id === onlySegment)
    : scenario.sequence

  if (segments.length === 0) {
    console.error(`Segment ${onlySegment} not found!`)
    process.exit(1)
  }

  const results = []

  for (const segment of segments) {
    const participant = scenario.participants[segment.speaker]
    console.log(`\n── ${segment.id}: ${participant.role} (${participant.name}) ──`)

    // Step 1: Audio
    const audioPath = await generateAudio(segment)

    // Step 2: Video (unless --audio-only)
    let videoPath = null
    if (!audioOnly) {
      videoPath = await generateVideo(segment, audioPath)
    }

    results.push({
      id: segment.id,
      speaker: segment.speaker,
      role: participant.role,
      audio: `/audio-scenario/${segment.id}.mp3`,
      video: videoPath ? `/videos-scenario/${segment.id}.mp4` : null,
    })
  }

  // Save results manifest
  const manifestPath = path.join(ROOT, 'public', 'scenario-manifest.json')
  fs.writeFileSync(manifestPath, JSON.stringify({ segments: results }, null, 2))
  console.log(`\n═══════════════════════════════════════════════════`)
  console.log(`  ✅ Done! Manifest: public/scenario-manifest.json`)
  console.log(`  Audio: ${AUDIO_DIR}`)
  console.log(`  Video: ${VIDEO_DIR}`)
  console.log(`═══════════════════════════════════════════════════\n`)

  // Summary
  const audioCount = results.filter(r => r.audio).length
  const videoCount = results.filter(r => r.video).length
  console.log(`  📊 ${audioCount} audios, ${videoCount} videos generated`)

  if (videoCount < results.length) {
    console.log(`\n  ⚠️  Pour les vidéos manquantes, place les photos dans public/photos/:`)
    const missing = [...new Set(results.filter(r => !r.video).map(r => r.speaker))]
    for (const pid of missing) {
      console.log(`     → ${pid}.jpg (photo webcam-style dans un bureau)`)
    }
  }
}

main().catch(err => {
  console.error('\n❌ Fatal error:', err.message)
  process.exit(1)
})
