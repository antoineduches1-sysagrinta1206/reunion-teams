import { writeFile } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const videosDir = join(__dirname, '..', 'public', 'videos')

// Pexels video page URLs — we'll extract the actual video file URL from the page
const VIDEOS = [
  { id: 'ai-1-talk', pageUrl: 'https://www.pexels.com/video/woman-talking-in-front-of-the-camera-8048443/' },
  { id: 'ai-2-talk', pageUrl: 'https://www.pexels.com/video/man-talking-in-front-of-camera-8048256/' },
  { id: 'ai-3-talk', pageUrl: 'https://www.pexels.com/video/a-businesswoman-talking-in-a-video-call-meeting-5198148/' },
  { id: 'ai-4-talk', pageUrl: 'https://www.pexels.com/video/a-man-talking-to-the-camera-8135878/' },
  { id: 'ai-5-talk', pageUrl: 'https://www.pexels.com/video/woman-in-an-office-having-a-video-call-7534793/' },
]

async function extractVideoUrl(pageUrl) {
  const res = await fetch(pageUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
  })
  const html = await res.text()

  // Try to find video file URLs in the page
  // Pattern 1: Look for .mp4 URLs in the HTML
  const mp4Matches = html.match(/https:\/\/videos\.pexels\.com\/video-files\/\d+\/[^"'\s]+\.mp4/g)
  
  if (mp4Matches && mp4Matches.length > 0) {
    // Prefer SD quality (smaller file) — look for 640 or 960 width
    const sdVideo = mp4Matches.find(u => u.includes('sd_640') || u.includes('sd_960'))
      || mp4Matches.find(u => u.includes('sd_'))
      || mp4Matches.find(u => u.includes('hd_1280'))
      || mp4Matches[0]
    return sdVideo
  }

  // Pattern 2: Look in JSON data
  const jsonMatch = html.match(/"contentUrl"\s*:\s*"([^"]+\.mp4[^"]*)"/i)
  if (jsonMatch) return jsonMatch[1]

  return null
}

async function downloadVideo(url, filePath) {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const buffer = Buffer.from(await res.arrayBuffer())
  await writeFile(filePath, buffer)
  return buffer.length
}

async function main() {
  console.log('Extracting and downloading Pexels stock videos...\n')

  for (const video of VIDEOS) {
    console.log(`Processing ${video.id}...`)
    try {
      const videoUrl = await extractVideoUrl(video.pageUrl)
      if (!videoUrl) {
        console.error(`  ✗ Could not find video URL on page`)
        continue
      }
      console.log(`  Found: ${videoUrl.substring(0, 80)}...`)
      
      const filePath = join(videosDir, `${video.id}.mp4`)
      const size = await downloadVideo(videoUrl, filePath)
      console.log(`  ✓ Saved ${video.id}.mp4 (${(size / 1024 / 1024).toFixed(1)} MB)`)
    } catch (e) {
      console.error(`  ✗ Failed: ${e.message}`)
    }
  }

  console.log('\nDone!')
}

main()
