import { writeFile } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const facesDir = join(__dirname, '..', 'public', 'faces')

// Professional people in office/business settings — upper body shots showing suit + office background
const PHOTOS = [
  { id: 'ai-1', url: 'https://images.pexels.com/photos/3756679/pexels-photo-3756679.jpeg?auto=compress&cs=tinysrgb&w=640&h=480&fit=crop&crop=top' },
  { id: 'ai-2', url: 'https://images.pexels.com/photos/3184611/pexels-photo-3184611.jpeg?auto=compress&cs=tinysrgb&w=640&h=480&fit=crop&crop=top' },
  { id: 'ai-3', url: 'https://images.pexels.com/photos/3756681/pexels-photo-3756681.jpeg?auto=compress&cs=tinysrgb&w=640&h=480&fit=crop&crop=top' },
  { id: 'ai-4', url: 'https://images.pexels.com/photos/3184292/pexels-photo-3184292.jpeg?auto=compress&cs=tinysrgb&w=640&h=480&fit=crop&crop=top' },
  { id: 'ai-5', url: 'https://images.pexels.com/photos/3756678/pexels-photo-3756678.jpeg?auto=compress&cs=tinysrgb&w=640&h=480&fit=crop&crop=top' },
]

async function downloadFaces() {
  for (const photo of PHOTOS) {
    console.log(`Downloading ${photo.id}...`)
    try {
      const res = await fetch(photo.url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const buffer = Buffer.from(await res.arrayBuffer())
      const filePath = join(facesDir, `${photo.id}.jpg`)
      await writeFile(filePath, buffer)
      console.log(`  ✓ Saved ${photo.id}.jpg (${(buffer.length / 1024).toFixed(0)} KB)`)
    } catch (e) {
      console.error(`  ✗ Failed ${photo.id}:`, e.message)
    }
  }
  console.log('\nDone! Photos saved to public/faces/')
}

downloadFaces()
