// Quick test for the lipsync API
const res = await fetch('http://localhost:3001/api/lipsync', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ text: 'Bonjour', participantId: 'p1' }),
})

const data = await res.json()
console.log('Status:', res.status)
console.log('Response keys:', Object.keys(data))
if (data.error) console.log('ERROR:', data.error)
if (data.videoUrl) console.log('VIDEO URL:', data.videoUrl)
if (data.audioBase64) console.log('AUDIO: data URL length =', data.audioBase64.length)
