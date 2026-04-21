import fs from 'fs'
import path from 'path'

const DID_KEY = 'am9lbHBpZXM0NUBnbWFpbC5jb20:1_KannmC3jv2uC5hU1n-I'

async function uploadPhoto(filename) {
  const filePath = path.join(process.cwd(), 'public', 'photos', filename)
  const buffer = fs.readFileSync(filePath)
  const blob = new Blob([buffer], { type: 'image/jpeg' })

  const form = new FormData()
  form.append('image', blob, filename)

  console.log(`Uploading ${filename} (${buffer.length} bytes)...`)
  const res = await fetch('https://api.d-id.com/images', {
    method: 'POST',
    headers: { 'Authorization': `Basic ${DID_KEY}` },
    body: form,
  })

  const data = await res.json()
  console.log(`Status: ${res.status}`)
  console.log(`Response:`, JSON.stringify(data, null, 2))
  return data
}

console.log('=== Uploading p1.jpg ===')
const p1 = await uploadPhoto('p1.jpg')

console.log('\n=== Uploading p2.jpg ===')
const p2 = await uploadPhoto('p2.jpg')

console.log('\n=== RESULTS ===')
console.log('p1 URL:', p1.url || 'FAILED')
console.log('p2 URL:', p2.url || 'FAILED')

// Save URLs for use in the app
const urls = { p1: p1.url, p2: p2.url }
fs.writeFileSync(path.join(process.cwd(), 'public', 'photos', 'did-urls.json'), JSON.stringify(urls, null, 2))
console.log('\nSaved to public/photos/did-urls.json')
