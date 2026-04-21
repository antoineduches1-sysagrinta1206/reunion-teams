import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const API_KEY = process.env.HEYGEN_API_KEY

if (!API_KEY) { console.error('Set HEYGEN_API_KEY'); process.exit(1) }

const photoPath = path.join(__dirname, '..', 'public', 'faces', 'user-face.jpg')
const photoBuffer = fs.readFileSync(photoPath)

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

// Step 1: Upload photo to HeyGen
console.log('Step 1: Uploading photo to HeyGen...')
const uploadRes = await fetch('https://upload.heygen.com/v1/asset', {
  method: 'POST',
  headers: {
    'X-Api-Key': API_KEY,
    'Content-Type': 'image/jpeg',
  },
  body: photoBuffer,
})

if (!uploadRes.ok) {
  console.error('Upload failed:', uploadRes.status, await uploadRes.text())
  process.exit(1)
}

const uploadData = await uploadRes.json()
console.log('Upload response:', JSON.stringify(uploadData, null, 2))

// Step 2: Create a photo avatar group
const imageKey = uploadData.data?.image_key || uploadData.data?.asset_id || uploadData.data?.id
console.log('Image key:', imageKey)

console.log('\nStep 2: Creating photo avatar group...')
const groupRes = await fetch('https://api.heygen.com/v2/photo_avatar/photo_avatar_group', {
  method: 'POST',
  headers: {
    'X-Api-Key': API_KEY,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    name: 'UserCustomAvatar',
    image_keys: [imageKey],
  }),
})

const groupText = await groupRes.text()
console.log('Group response:', groupRes.status, groupText)

let groupData
try { groupData = JSON.parse(groupText) } catch { groupData = {} }

// Step 3: Train the group
const groupId = groupData.data?.photo_avatar_group_id || groupData.data?.id
if (groupId) {
  console.log('\nStep 3: Training avatar group:', groupId)
  const trainRes = await fetch(`https://api.heygen.com/v2/photo_avatar/train/${groupId}`, {
    method: 'POST',
    headers: { 'X-Api-Key': API_KEY },
  })
  console.log('Train response:', trainRes.status, await trainRes.text())

  // Poll training status
  for (let i = 0; i < 60; i++) {
    await sleep(5000)
    const statusRes = await fetch(`https://api.heygen.com/v2/photo_avatar/photo_avatar_group/${groupId}`, {
      headers: { 'X-Api-Key': API_KEY },
    })
    const statusData = await statusRes.json()
    const status = statusData.data?.status || statusData.data?.training_status
    if (i % 6 === 0) console.log(`  Training poll ${i}: ${JSON.stringify(statusData.data?.status || statusData.data)}`)
    if (status === 'trained' || status === 'completed' || status === 'ready') {
      console.log('Training complete!')
      console.log('Avatar data:', JSON.stringify(statusData.data, null, 2))
      break
    }
    if (status === 'failed') {
      console.error('Training failed:', JSON.stringify(statusData.data))
      break
    }
  }
}

// Step 4: Also try the simpler talking_photo upload (legacy endpoint)
console.log('\nStep 4: Trying legacy talking_photo upload...')
const tpRes = await fetch('https://api.heygen.com/v1/talking_photo', {
  method: 'POST',
  headers: {
    'X-Api-Key': API_KEY,
    'Content-Type': 'image/jpeg',
  },
  body: photoBuffer,
})
console.log('Talking photo response:', tpRes.status, await tpRes.text())

// Step 5: List existing talking photos
console.log('\nStep 5: Listing talking photos...')
const listRes = await fetch('https://api.heygen.com/v1/talking_photo', {
  headers: { 'X-Api-Key': API_KEY },
})
console.log('List response:', listRes.status)
const listData = await listRes.json()
console.log('Talking photos:', JSON.stringify(listData, null, 2))
