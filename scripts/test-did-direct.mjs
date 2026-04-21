import fs from 'fs'
import path from 'path'

const DID_KEY = 'am9lbHBpZXM0NUBnbWFpbC5jb20:1_KannmC3jv2uC5hU1n-I'
const ELEVENLABS_KEY = 'sk_934380848cd625fb4b2a89b7a045fefc2c880e0b83b6db2e'

// 1. Get photo as base64
const photoPath = path.join(process.cwd(), 'public', 'photos', 'p1.jpg')
const photoBuffer = fs.readFileSync(photoPath)
const photoB64 = `data:image/jpeg;base64,${photoBuffer.toString('base64')}`
console.log(`Photo: ${photoBuffer.length} bytes, base64 URL length: ${photoB64.length}`)

// 2. Generate TTS audio
console.log('Generating TTS...')
const ttsRes = await fetch('https://api.elevenlabs.io/v1/text-to-speech/EXAVITQu4vr4xnSDxMaL', {
  method: 'POST',
  headers: {
    'Accept': 'audio/mpeg',
    'Content-Type': 'application/json',
    'xi-api-key': ELEVENLABS_KEY,
  },
  body: JSON.stringify({
    text: 'Bonjour',
    model_id: 'eleven_multilingual_v2',
    voice_settings: { stability: 0.5, similarity_boost: 0.75 },
  }),
})
console.log('TTS status:', ttsRes.status)
const audioBuffer = Buffer.from(await ttsRes.arrayBuffer())
const audioB64 = `data:audio/mpeg;base64,${audioBuffer.toString('base64')}`
console.log(`Audio: ${audioBuffer.length} bytes, base64 URL length: ${audioB64.length}`)

// 3. Create D-ID talk
console.log('Creating D-ID talk...')
const createRes = await fetch('https://api.d-id.com/talks', {
  method: 'POST',
  headers: {
    'Authorization': `Basic ${DID_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    source_url: photoB64,
    script: {
      type: 'audio',
      audio_url: audioB64,
    },
    config: { stitch: true, result_format: 'mp4' },
  }),
})
const createText = await createRes.text()
console.log('D-ID create status:', createRes.status)
console.log('D-ID create response:', createText.slice(0, 500))

if (createRes.status !== 201) {
  console.log('FAILED - stopping')
  process.exit(1)
}

const { id: talkId } = JSON.parse(createText)
console.log('Talk ID:', talkId)

// 4. Poll
for (let i = 0; i < 30; i++) {
  await new Promise(r => setTimeout(r, 2000))
  const pollRes = await fetch(`https://api.d-id.com/talks/${talkId}`, {
    headers: { 'Authorization': `Basic ${DID_KEY}` },
  })
  const pollData = await pollRes.json()
  console.log(`Poll ${i+1}: ${pollData.status}`)
  if (pollData.status === 'done') {
    console.log('VIDEO URL:', pollData.result_url)
    process.exit(0)
  }
  if (pollData.status === 'error') {
    console.log('ERROR:', JSON.stringify(pollData))
    process.exit(1)
  }
}
console.log('TIMEOUT')
