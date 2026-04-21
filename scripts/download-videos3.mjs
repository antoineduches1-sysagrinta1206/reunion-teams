import { writeFile } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const videosDir = join(__dirname, '..', 'public', 'videos')

// Many Pexels video IDs of people talking in offices / video calls
const VIDEO_IDS = [
  // Women talking to camera / in meetings
  8048443, 5198148, 7534793, 6774434, 3253066,
  4488917, 5530953, 4488636, 7655011, 8962199,
  // Men talking to camera / in offices
  8048256, 8135878, 4065925, 3209828, 3252376,
  4107274, 4065929, 7580220, 5530961, 6774418,
]

// Try many resolution/framerate combos
const PATTERNS = [
  (id) => `https://videos.pexels.com/video-files/${id}/${id}-sd_640_360_25fps.mp4`,
  (id) => `https://videos.pexels.com/video-files/${id}/${id}-sd_640_360_30fps.mp4`,
  (id) => `https://videos.pexels.com/video-files/${id}/${id}-sd_640_360_24fps.mp4`,
  (id) => `https://videos.pexels.com/video-files/${id}/${id}-sd_960_540_25fps.mp4`,
  (id) => `https://videos.pexels.com/video-files/${id}/${id}-sd_960_540_30fps.mp4`,
  (id) => `https://videos.pexels.com/video-files/${id}/${id}-sd_960_540_24fps.mp4`,
  (id) => `https://videos.pexels.com/video-files/${id}/${id}-hd_1280_720_25fps.mp4`,
  (id) => `https://videos.pexels.com/video-files/${id}/${id}-hd_1280_720_30fps.mp4`,
  (id) => `https://videos.pexels.com/video-files/${id}/${id}-hd_1920_1080_25fps.mp4`,
]

async function tryDownload(videoId) {
  for (const pattern of PATTERNS) {
    const url = pattern(videoId)
    try {
      const res = await fetch(url, { method: 'HEAD', redirect: 'follow' })
      if (res.ok) {
        return url
      }
    } catch (e) { /* next */ }
  }
  return null
}

async function main() {
  console.log('Scanning Pexels for working video URLs...\n')
  const found = []

  for (const id of VIDEO_IDS) {
    if (found.length >= 5) break
    process.stdout.write(`  Trying ${id}... `)
    const url = await tryDownload(id)
    if (url) {
      found.push({ id, url })
      console.log(`✓ FOUND`)
    } else {
      console.log(`✗`)
    }
  }

  console.log(`\nFound ${found.length} working videos. Downloading...\n`)

  const names = ['ai-1-talk', 'ai-2-talk', 'ai-3-talk', 'ai-4-talk', 'ai-5-talk']
  for (let i = 0; i < Math.min(found.length, 5); i++) {
    const { url } = found[i]
    console.log(`Downloading ${names[i]} from ${url.split('/').pop()}...`)
    const res = await fetch(url)
    const buffer = Buffer.from(await res.arrayBuffer())
    await writeFile(join(videosDir, `${names[i]}.mp4`), buffer)
    console.log(`  ✓ ${names[i]}.mp4 (${(buffer.length / 1024 / 1024).toFixed(1)} MB)`)
  }

  console.log('\nDone!')
}

main()
