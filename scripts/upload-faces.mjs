import { readFile, writeFile } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const facesDir = join(__dirname, '..', 'public', 'faces')

const PARTICIPANTS = ['ai-1', 'ai-2', 'ai-3', 'ai-4', 'ai-5']

async function uploadToCatbox(filePath) {
  const buffer = await readFile(filePath)
  const blob = new Blob([buffer], { type: 'image/jpeg' })
  
  const formData = new FormData()
  formData.append('reqtype', 'fileupload')
  formData.append('fileToUpload', blob, 'photo.jpg')

  const res = await fetch('https://catbox.moe/user/api.php', {
    method: 'POST',
    body: formData,
  })

  if (!res.ok) throw new Error(`Upload failed: ${res.status}`)
  return await res.text()
}

async function main() {
  const urls = {}

  for (const id of PARTICIPANTS) {
    const filePath = join(facesDir, `${id}.jpg`)
    console.log(`Uploading ${id}...`)
    try {
      const url = await uploadToCatbox(filePath)
      urls[id] = url.trim()
      console.log(`  ✓ ${id}: ${urls[id]}`)
    } catch (e) {
      console.error(`  ✗ ${id} failed:`, e.message)
    }
  }

  // Save URLs to a config file
  const configPath = join(__dirname, '..', 'public', 'faces', 'urls.json')
  await writeFile(configPath, JSON.stringify(urls, null, 2))
  console.log('\nURLs saved to public/faces/urls.json')
  console.log('\nCopy these into page.tsx PARTICIPANT_PHOTOS:')
  console.log(JSON.stringify(urls, null, 2))
}

main()
