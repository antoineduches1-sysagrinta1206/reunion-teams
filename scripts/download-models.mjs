import fs from 'fs'
import path from 'path'

const BASE = 'https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights'
const OUT = path.join(process.cwd(), 'public', 'models')

const FILES = [
  'tiny_face_detector_model-shard1',
  'tiny_face_detector_model-weights_manifest.json',
  'face_landmark_68_model-shard1',
  'face_landmark_68_model-weights_manifest.json',
]

for (const file of FILES) {
  const url = `${BASE}/${file}`
  console.log(`Downloading ${file}...`)
  const res = await fetch(url)
  if (!res.ok) {
    console.error(`  FAILED: ${res.status}`)
    continue
  }
  const buffer = Buffer.from(await res.arrayBuffer())
  fs.writeFileSync(path.join(OUT, file), buffer)
  console.log(`  OK (${(buffer.length / 1024).toFixed(0)} KB)`)
}

console.log('\nDone! Models saved to public/models/')
