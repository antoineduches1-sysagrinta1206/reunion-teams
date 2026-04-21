import fs from 'fs'

console.log('Calling /api/lipsync...')
const start = Date.now()

const res = await fetch('http://localhost:3001/api/lipsync', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ text: 'Bonjour, je suis Victoria', participantId: 'p1' }),
})

const data = await res.json()
const elapsed = ((Date.now() - start) / 1000).toFixed(1)

const summary = {
  httpStatus: res.status,
  error: data.error || null,
  videoUrl: data.videoUrl || null,
  elapsed: `${elapsed}s`,
}

fs.writeFileSync('scripts/lipsync-result3.json', JSON.stringify(summary, null, 2))
console.log(JSON.stringify(summary, null, 2))
