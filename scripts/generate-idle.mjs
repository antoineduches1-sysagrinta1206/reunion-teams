import fs from 'fs'
import path from 'path'

const DID_KEY = 'am9lbHBpZXM0NUBnbWFpbC5jb20:1_KannmC3jv2uC5hU1n-I'

// Load uploaded photo URLs
const urls = JSON.parse(fs.readFileSync('public/photos/did-urls.json', 'utf-8'))

async function generateIdle(participantId, photoUrl) {
  console.log(`\n=== Generating idle for ${participantId} ===`)
  console.log(`Photo: ${photoUrl}`)

  // Try D-ID animations endpoint (face animation without speech)
  const createRes = await fetch('https://api.d-id.com/animations', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${DID_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      source_url: photoUrl,
      config: {
        stitch: true,
        result_format: 'mp4',
      },
      // driver_url uses D-ID default driver for natural movements
    }),
  })

  const createText = await createRes.text()
  console.log(`Create status: ${createRes.status}`)
  console.log(`Create response: ${createText.slice(0, 300)}`)

  if (createRes.status !== 201 && createRes.status !== 200) {
    console.log('Animations endpoint failed, trying talks with silent text...')
    return await generateIdleViaTalks(participantId, photoUrl)
  }

  const createData = JSON.parse(createText)
  const animId = createData.id
  console.log(`Animation ID: ${animId}`)

  // Poll
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 2000))
    const pollRes = await fetch(`https://api.d-id.com/animations/${animId}`, {
      headers: { 'Authorization': `Basic ${DID_KEY}` },
    })
    const pollData = await pollRes.json()
    console.log(`Poll ${i + 1}: ${pollData.status}`)

    if (pollData.status === 'done' && pollData.result_url) {
      return await downloadVideo(participantId, pollData.result_url)
    }
    if (pollData.status === 'error') {
      console.log('ERROR:', JSON.stringify(pollData))
      return null
    }
  }
  return null
}

async function generateIdleViaTalks(participantId, photoUrl) {
  // Fallback: generate a talk with a brief "hmm" to get natural face animation
  const createRes = await fetch('https://api.d-id.com/talks', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${DID_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      source_url: photoUrl,
      script: {
        type: 'text',
        input: 'Hmm, voyons voir...',
        provider: {
          type: 'microsoft',
          voice_id: participantId === 'p1' ? 'fr-FR-DeniseNeural' : 'fr-FR-HenriNeural',
        },
      },
      config: {
        stitch: true,
        result_format: 'mp4',
      },
    }),
  })

  if (!createRes.ok) {
    console.log('Talks fallback failed:', createRes.status, await createRes.text())
    return null
  }

  const { id: talkId } = await createRes.json()
  console.log(`Talk ID (fallback): ${talkId}`)

  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 2000))
    const pollRes = await fetch(`https://api.d-id.com/talks/${talkId}`, {
      headers: { 'Authorization': `Basic ${DID_KEY}` },
    })
    const pollData = await pollRes.json()
    console.log(`Poll ${i + 1}: ${pollData.status}`)

    if (pollData.status === 'done' && pollData.result_url) {
      return await downloadVideo(participantId, pollData.result_url)
    }
    if (pollData.status === 'error') {
      console.log('ERROR:', JSON.stringify(pollData))
      return null
    }
  }
  return null
}

async function downloadVideo(participantId, url) {
  console.log(`Downloading: ${url.slice(0, 80)}...`)
  const res = await fetch(url)
  const buffer = Buffer.from(await res.arrayBuffer())

  const dir = path.join(process.cwd(), 'public', 'videos', 'idle')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  const filePath = path.join(dir, `${participantId}.mp4`)
  fs.writeFileSync(filePath, buffer)
  console.log(`Saved: ${filePath} (${buffer.length} bytes)`)
  return filePath
}

// Generate idle videos for p1 and p2
const p1 = await generateIdle('p1', urls.p1)
const p2 = await generateIdle('p2', urls.p2)

console.log('\n=== RESULTS ===')
console.log('p1 idle:', p1 || 'FAILED')
console.log('p2 idle:', p2 || 'FAILED')
