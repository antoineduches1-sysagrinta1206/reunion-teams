import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const API_KEY = process.env.HEYGEN_API_KEY || 'sk_V2_hgu_kWsFMPtA366_0WAszcC5SMn0NIqqChC07vGUnI3UuKfD'
const HEYGEN = 'https://api.heygen.com'

const VIDEO_PATH = path.join(__dirname, '..', 'public', 'videos', 'VIDEOVRAI-trimmed.mp4')
const OUTPUT_PATH = path.join(__dirname, '..', 'public', 'videos', 'lipsync-test.mp4')

// Text to lip-sync (test)
const NEW_TEXT = "Good morning everyone. Thank you for making the time. I'd like to begin with the quarterly performance review and our expansion strategy into the European market."

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function main() {
  console.log('=== HeyGen Lip-Sync Test ===')

  // Step 1: Upload the video to HeyGen
  console.log('1. Uploading video to HeyGen...')
  const videoData = fs.readFileSync(VIDEO_PATH)

  const uploadRes = await fetch('https://upload.heygen.com/v1/asset', {
    method: 'POST',
    headers: {
      'X-Api-Key': API_KEY,
      'Content-Type': 'video/mp4',
    },
    body: videoData,
  })

  if (!uploadRes.ok) {
    console.error('Upload failed:', uploadRes.status, await uploadRes.text())
    return
  }

  const uploadData = await uploadRes.json()
  console.log('Upload response:', JSON.stringify(uploadData, null, 2))
  const assetId = uploadData.data?.id || uploadData.data?.asset_id || uploadData.data?.url
  console.log('Asset ID/URL:', assetId)

  // Step 2: Try the video translate / lip-sync API
  console.log('\n2. Requesting lip-sync...')
  
  // Try v2 video_translate endpoint
  const translateRes = await fetch(`${HEYGEN}/v2/video_translate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': API_KEY },
    body: JSON.stringify({
      video_url: uploadData.data?.url || assetId,
      output_language: 'English',
      translate_audio_only: false,
      title: 'lipsync-test',
    }),
  })

  console.log('Translate status:', translateRes.status)
  const translateData = await translateRes.json()
  console.log('Translate response:', JSON.stringify(translateData, null, 2))

  // If translate doesn't support custom text, try personalized video API
  if (!translateRes.ok || translateData.error) {
    console.log('\n2b. Trying v2/video/generate with talking_photo approach...')
    
    // Use the uploaded video as a talking photo source
    const genRes = await fetch(`${HEYGEN}/v2/video/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': API_KEY },
      body: JSON.stringify({
        video_inputs: [{
          character: {
            type: 'talking_photo',
            talking_photo_url: uploadData.data?.url || assetId,
          },
          voice: {
            type: 'text',
            input_text: NEW_TEXT,
            voice_id: 'c218750e46864dba9c45b9e40fe91aef',
          },
        }],
        dimension: { width: 832, height: 448 },
      }),
    })

    console.log('Generate status:', genRes.status)
    const genData = await genRes.json()
    console.log('Generate response:', JSON.stringify(genData, null, 2))

    if (genData.data?.video_id) {
      await pollAndDownload(genData.data.video_id)
      return
    }
  }

  // If translate worked, poll for it
  const videoId = translateData.data?.video_id || translateData.data?.video_translate_id
  if (videoId) {
    await pollAndDownload(videoId)
  }
}

async function pollAndDownload(videoId) {
  console.log(`\n3. Polling video ${videoId}...`)
  for (let i = 0; i < 300; i++) {
    await sleep(2000)
    
    // Try both status endpoints
    let statusData
    const res1 = await fetch(`${HEYGEN}/v1/video_status.get?video_id=${videoId}`, {
      headers: { 'X-Api-Key': API_KEY },
    })
    if (res1.ok) {
      statusData = await res1.json()
    }

    const status = statusData?.data?.status
    if (i % 10 === 0) console.log(`  Poll ${i}: ${status}`)

    if (status === 'completed') {
      const url = statusData.data.video_url
      console.log('  ✓ Completed! Downloading...')
      const vidRes = await fetch(url)
      if (vidRes.ok) {
        const buf = Buffer.from(await vidRes.arrayBuffer())
        fs.writeFileSync(OUTPUT_PATH, buf)
        console.log(`  ✓ Saved: ${OUTPUT_PATH} (${(buf.length/1024/1024).toFixed(1)} MB)`)
      }
      return
    } else if (status === 'failed') {
      console.error('  ✗ FAILED:', statusData.data?.error)
      return
    }
  }
  console.error('  ✗ TIMEOUT')
}

main().catch(console.error)
