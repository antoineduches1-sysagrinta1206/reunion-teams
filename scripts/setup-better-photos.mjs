import fs from 'fs'
import path from 'path'

const DID_KEY = 'am9lbHBpZXM0NUBnbWFpbC5jb20:1_KannmC3jv2uC5hU1n-I'

// High-quality professional headshots from Unsplash (free, front-facing, well-lit)
const PHOTOS = {
  p1: {
    // Professional woman — clean, front-facing, high-res
    url: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=768&h=768&fit=crop&crop=face&q=90',
    name: 'Victoria',
  },
  p2: {
    // Professional man — clean, front-facing, high-res
    url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=768&h=768&fit=crop&crop=face&q=90',
    name: 'Marcus',
  },
}

async function downloadPhoto(id, photoUrl, name) {
  console.log(`\nDownloading ${name} (${id})...`)
  const res = await fetch(photoUrl)
  if (!res.ok) throw new Error(`Download failed: ${res.status}`)
  const buffer = Buffer.from(await res.arrayBuffer())

  const dir = path.join(process.cwd(), 'public', 'photos')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  const filePath = path.join(dir, `${id}.jpg`)
  fs.writeFileSync(filePath, buffer)
  console.log(`  Saved: ${filePath} (${(buffer.length / 1024).toFixed(0)} KB)`)
  return { buffer, filePath }
}

async function uploadToDID(id, buffer) {
  console.log(`  Uploading ${id} to D-ID...`)
  const blob = new Blob([buffer], { type: 'image/jpeg' })
  const form = new FormData()
  form.append('image', blob, `${id}.jpg`)

  const res = await fetch('https://api.d-id.com/images', {
    method: 'POST',
    headers: { 'Authorization': `Basic ${DID_KEY}` },
    body: form,
  })
  const data = await res.json()
  if (res.status !== 201) throw new Error(`Upload failed: ${JSON.stringify(data)}`)
  console.log(`  D-ID URL: ${data.url}`)
  return data.url
}

async function generateIdle(id, didUrl) {
  console.log(`  Generating idle animation for ${id}...`)
  const createRes = await fetch('https://api.d-id.com/animations', {
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

  if (createRes.status !== 201) {
    const err = await createRes.text()
    throw new Error(`Animation create failed: ${err}`)
  }

  const { id: animId } = await createRes.json()
  console.log(`  Animation ID: ${animId}`)

  // Poll
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 2000))
    const pollRes = await fetch(`https://api.d-id.com/animations/${animId}`, {
      headers: { 'Authorization': `Basic ${DID_KEY}` },
    })
    const pollData = await pollRes.json()
    process.stdout.write(`  Poll ${i + 1}: ${pollData.status}\n`)

    if (pollData.status === 'done' && pollData.result_url) {
      // Download the video
      const vidRes = await fetch(pollData.result_url)
      const vidBuffer = Buffer.from(await vidRes.arrayBuffer())
      const dir = path.join(process.cwd(), 'public', 'videos', 'idle')
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      const vidPath = path.join(dir, `${id}.mp4`)
      fs.writeFileSync(vidPath, vidBuffer)
      console.log(`  Idle video: ${vidPath} (${(vidBuffer.length / 1024).toFixed(0)} KB)`)
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

for (const [id, info] of Object.entries(PHOTOS)) {
  try {
    const { buffer } = await downloadPhoto(id, info.url, info.name)
    const didUrl = await uploadToDID(id, buffer)
    didUrls[id] = didUrl
    await generateIdle(id, didUrl)
    console.log(`  ✅ ${info.name} done!`)
  } catch (err) {
    console.error(`  ❌ ${info.name} failed:`, err.message)
  }
}

// Save D-ID URLs
const urlsPath = path.join(process.cwd(), 'public', 'photos', 'did-urls.json')
fs.writeFileSync(urlsPath, JSON.stringify(didUrls, null, 2))
console.log(`\nD-ID URLs saved to ${urlsPath}`)
console.log(JSON.stringify(didUrls, null, 2))
