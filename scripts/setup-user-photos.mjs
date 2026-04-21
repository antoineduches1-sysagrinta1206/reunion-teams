import fs from 'fs'
import path from 'path'

const DID_KEY = 'am9lbHBpZXM0NUBnbWFpbC5jb20:1_KannmC3jv2uC5hU1n-I'

const PHOTOS = {
  p1: 'J1.jpg',  // Homme costume bleu
  p2: 'J2.jpg',  // Homme costume sombre
}

async function uploadToDID(id, filename) {
  const filePath = path.join(process.cwd(), 'public', 'photos', filename)
  const buffer = fs.readFileSync(filePath)
  console.log(`\n[${id}] Uploading ${filename} (${(buffer.length / 1024).toFixed(0)} KB)...`)

  const blob = new Blob([buffer], { type: 'image/jpeg' })
  const form = new FormData()
  form.append('image', blob, filename)

  const res = await fetch('https://api.d-id.com/images', {
    method: 'POST',
    headers: { 'Authorization': `Basic ${DID_KEY}` },
    body: form,
  })
  const data = await res.json()
  if (res.status !== 201) throw new Error(`Upload failed: ${JSON.stringify(data)}`)
  console.log(`[${id}] D-ID URL: ${data.url}`)
  return data.url
}

async function generateIdleSubtle(id, didUrl) {
  console.log(`[${id}] Generating SUBTLE idle (blinks only, minimal head movement)...`)

  // Use D-ID animations with a very subtle driver
  // driver_url "bank://nostalgia" is known for minimal movement
  const createRes = await fetch('https://api.d-id.com/animations', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${DID_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      source_url: didUrl,
      driver_url: 'bank://nostalgia/',
      config: {
        stitch: true,
        result_format: 'mp4',
      },
    }),
  })

  if (createRes.status !== 201) {
    const errText = await createRes.text()
    console.log(`[${id}] Nostalgia driver failed (${createRes.status}), trying default...`)
    
    // Fallback: use default animation but it will still be better with HD photos
    const fallbackRes = await fetch('https://api.d-id.com/animations', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${DID_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        source_url: didUrl,
        config: {
          stitch: true,
          result_format: 'mp4',
        },
      }),
    })
    if (fallbackRes.status !== 201) {
      throw new Error(`Animation create failed: ${await fallbackRes.text()}`)
    }
    const { id: animId } = await fallbackRes.json()
    return await pollAnimation(id, animId)
  }

  const { id: animId } = await createRes.json()
  console.log(`[${id}] Animation ID: ${animId}`)
  return await pollAnimation(id, animId)
}

async function pollAnimation(id, animId) {
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 2000))
    const pollRes = await fetch(`https://api.d-id.com/animations/${animId}`, {
      headers: { 'Authorization': `Basic ${DID_KEY}` },
    })
    const pollData = await pollRes.json()
    console.log(`[${id}] Poll ${i + 1}: ${pollData.status}`)

    if (pollData.status === 'done' && pollData.result_url) {
      const vidRes = await fetch(pollData.result_url)
      const vidBuffer = Buffer.from(await vidRes.arrayBuffer())
      const dir = path.join(process.cwd(), 'public', 'videos', 'idle')
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      const vidPath = path.join(dir, `${id}.mp4`)
      fs.writeFileSync(vidPath, vidBuffer)
      console.log(`[${id}] ✅ Idle saved: ${vidPath} (${(vidBuffer.length / 1024).toFixed(0)} KB)`)
      return vidPath
    }
    if (pollData.status === 'error') {
      throw new Error(`Animation failed: ${JSON.stringify(pollData)}`)
    }
  }
  throw new Error('Animation timeout')
}

// Main
const didUrls = {}

for (const [id, filename] of Object.entries(PHOTOS)) {
  try {
    const didUrl = await uploadToDID(id, filename)
    didUrls[id] = didUrl
    await generateIdleSubtle(id, didUrl)
  } catch (err) {
    console.error(`[${id}] ❌ Error:`, err.message)
  }
}

// Save D-ID URLs
const urlsPath = path.join(process.cwd(), 'public', 'photos', 'did-urls.json')
fs.writeFileSync(urlsPath, JSON.stringify(didUrls, null, 2))
console.log(`\n✅ D-ID URLs saved: ${JSON.stringify(didUrls, null, 2)}`)
