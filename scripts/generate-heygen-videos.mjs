import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HEYGEN_API = 'https://api.heygen.com'
const API_KEY = process.env.HEYGEN_API_KEY

if (!API_KEY) {
  console.error('ERROR: Set HEYGEN_API_KEY environment variable')
  process.exit(1)
}

// Same config as page.tsx — STANDARD avatars (faster)
const HEYGEN_CONFIG = {
  'ai-1': { avatarId: 'Daisy-insuit-20220818', voiceId: 'c218750e46864dba9c45b9e40fe91aef' },
  'ai-2': { avatarId: 'Tyler-insuit-20220721', voiceId: 'e17b99e1b86e47e8b7f4cae0f806aa78' },
  'ai-3': { avatarId: 'Zosia_public_2', voiceId: '727e9d6d492e456b9f27708fa8018744' },
  'ai-4': { avatarId: 'Mido-pro-insuit-20221208', voiceId: 'ff465a8dab0d42c78f874a135b11d47d' },
  'ai-5': { avatarId: 'Daisy-inshirt-20220818', voiceId: '628161fd1c79432d853b610e84dbc7a4' },
}

// Office background image (modern meeting room)
const OFFICE_BG_URL = 'https://images.unsplash.com/photo-1497366216548-37526070297c?w=1280&h=720&fit=crop'

const AI_SCRIPTS = [
  { participantId: 'ai-1', text: "Good morning everyone. Thank you for making the time. I'd like to begin with the quarterly performance review and our expansion strategy into the European market." },
  { participantId: 'ai-2', text: "Thank you Victoria. I've had our legal team review the merger documents. The due diligence is complete and the numbers are looking very favorable for the acquisition." },
  { participantId: 'ai-3', text: "Excellent. From the finance side, our portfolio has outperformed expectations by twelve percent this quarter. The board will be pleased with these results." },
  { participantId: 'ai-4', text: "That's outstanding. I've been in discussions with our partners in London and Geneva. They're very keen to move forward with the joint venture by end of month." },
  { participantId: 'ai-1', text: "Wonderful. Now regarding the shareholders meeting next week, I want to ensure we present a unified strategy. Catherine, could you prepare the financial overview?" },
  { participantId: 'ai-3', text: "Absolutely. I'll have the full report ready by Wednesday. I'll also include the projections for the next fiscal year based on our current trajectory." },
  { participantId: 'ai-2', text: "I should mention that our competitors have been making aggressive moves in the Asian market. We may need to accelerate our timeline on the Singapore office." },
  { participantId: 'ai-4', text: "Agreed. I'll arrange a meeting with the Singapore development authority this week. We should secure the location before the end of the quarter." },
  { participantId: 'ai-1', text: "Perfect. Let's reconvene on Thursday to finalize everything. Thank you all for your excellent work. This has been a very productive session." },
]

const OUTPUT_DIR = path.join(__dirname, '..', 'public', 'videos')

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

// Generic video creation function — used for both talking & idle
async function createHeyGenVideo(avatarId, voiceId, text, outFile, label) {
  if (fs.existsSync(outFile)) {
    console.log(`  [${label}] Already exists: ${path.basename(outFile)}`)
    return true
  }

  console.log(`  [${label}] Generating...`)

  const createRes = await fetch(`${HEYGEN_API}/v2/video/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': API_KEY },
    body: JSON.stringify({
      video_inputs: [{
        character: { type: 'avatar', avatar_id: avatarId, avatar_style: 'normal' },
        voice: { type: 'text', input_text: text, voice_id: voiceId },
        background: { type: 'image', url: OFFICE_BG_URL },
      }],
      dimension: { width: 1280, height: 720 },
    }),
  })

  if (!createRes.ok) {
    console.error(`  ERROR creating: ${createRes.status} ${await createRes.text()}`)
    return false
  }

  const { data } = await createRes.json()
  const videoId = data?.video_id
  if (!videoId) { console.error('  ERROR: no video_id'); return false }

  console.log(`  Video ID: ${videoId} — polling...`)

  // Poll until done (up to 10 minutes)
  for (let i = 0; i < 300; i++) {
    await sleep(2000)
    const statusRes = await fetch(`${HEYGEN_API}/v1/video_status.get?video_id=${videoId}`, {
      headers: { 'X-Api-Key': API_KEY },
    })
    if (!statusRes.ok) continue
    const statusData = await statusRes.json()
    const status = statusData.data?.status

    if (i % 15 === 0) console.log(`  Poll ${i}: ${status}`)

    if (status === 'completed') {
      const videoUrl = statusData.data.video_url
      console.log(`  ✓ Completed! Downloading...`)

      const videoRes = await fetch(videoUrl)
      if (!videoRes.ok) { console.error('  ERROR downloading video'); return false }

      const buffer = Buffer.from(await videoRes.arrayBuffer())
      fs.writeFileSync(outFile, buffer)
      console.log(`  ✓ Saved: ${path.basename(outFile)} (${(buffer.length / 1024 / 1024).toFixed(1)} MB)`)
      return true
    } else if (status === 'failed') {
      console.error(`  ✗ FAILED: ${statusData.data?.error}`)
      return false
    }
  }

  console.error(`  ✗ TIMEOUT after 10 minutes`)
  return false
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true })

  console.log('=== HeyGen Video Pre-Generation (with office background) ===')
  console.log(`Output: ${OUTPUT_DIR}`)
  console.log('')

  // Step 1: Generate IDLE videos for each participant (short loop)
  console.log('--- IDLE VIDEOS (1 per participant) ---')
  const idleParticipants = Object.entries(HEYGEN_CONFIG)
  let idleSuccess = 0
  for (const [pid, cfg] of idleParticipants) {
    const outFile = path.join(OUTPUT_DIR, `idle-${pid}.mp4`)
    // Short idle text — creates natural sitting/listening animation
    const ok = await createHeyGenVideo(
      cfg.avatarId, cfg.voiceId,
      'Hmm, yes, I see.',
      outFile, `idle-${pid}`
    )
    if (ok) idleSuccess++
    await sleep(3000)
  }
  console.log(`Idle videos: ${idleSuccess}/${idleParticipants.length}\n`)

  // Step 2: Generate TALKING videos for each script line
  console.log('--- TALKING VIDEOS (1 per script line) ---')
  let talkSuccess = 0
  for (let i = 0; i < AI_SCRIPTS.length; i++) {
    const script = AI_SCRIPTS[i]
    const cfg = HEYGEN_CONFIG[script.participantId]
    const outFile = path.join(OUTPUT_DIR, `script-${i}.mp4`)
    console.log(`[${i + 1}/${AI_SCRIPTS.length}] ${script.participantId}: "${script.text.substring(0, 50)}..."`)
    const ok = await createHeyGenVideo(
      cfg.avatarId, cfg.voiceId,
      script.text,
      outFile, `script-${i}`
    )
    if (ok) talkSuccess++
    if (i < AI_SCRIPTS.length - 1) await sleep(3000)
  }

  console.log('')
  console.log(`=== Done: ${idleSuccess} idle + ${talkSuccess} talking videos ===`)
  console.log('Start the meeting with: npm run dev')
}

main().catch(console.error)
