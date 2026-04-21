import fs from 'fs'

const res = await fetch('http://localhost:3001/api/lipsync', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ text: 'Bonjour', participantId: 'p1' }),
})

const data = await res.json()

// Strip audioBase64 to keep output small
const summary = {
  status: res.status,
  error: data.error || null,
  videoUrl: data.videoUrl || null,
  hasAudio: !!data.audioBase64,
  keys: Object.keys(data),
}

fs.writeFileSync('scripts/lipsync-result.json', JSON.stringify(summary, null, 2))
console.log(JSON.stringify(summary, null, 2))
