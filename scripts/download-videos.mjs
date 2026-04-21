import { writeFile } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const videosDir = join(__dirname, '..', 'public', 'videos')

// Free Pexels stock videos of professionals talking to camera in office settings
// These are real people on video calls - exactly like a Teams meeting
const VIDEOS = [
  {
    id: 'ai-1-talk',
    // Professional woman talking to camera with headset in office
    url: 'https://videos.pexels.com/video-files/8048443/8048443-sd_640_360_25fps.mp4',
    fallbacks: [
      'https://videos.pexels.com/video-files/8048443/8048443-sd_960_540_25fps.mp4',
      'https://videos.pexels.com/video-files/8048443/8048443-hd_1280_720_25fps.mp4',
    ],
  },
  {
    id: 'ai-2-talk',
    // Professional man talking to camera in business setting
    url: 'https://videos.pexels.com/video-files/8048256/8048256-sd_640_360_25fps.mp4',
    fallbacks: [
      'https://videos.pexels.com/video-files/8048256/8048256-sd_960_540_25fps.mp4',
      'https://videos.pexels.com/video-files/8048256/8048256-hd_1280_720_25fps.mp4',
    ],
  },
  {
    id: 'ai-3-talk',
    // Woman speaking on video call / conference
    url: 'https://videos.pexels.com/video-files/5198148/5198148-sd_640_360_25fps.mp4',
    fallbacks: [
      'https://videos.pexels.com/video-files/5198148/5198148-sd_960_540_25fps.mp4',
      'https://videos.pexels.com/video-files/5198148/5198148-hd_1280_720_25fps.mp4',
      'https://videos.pexels.com/video-files/5198148/5198148-uhd_2560_1440_25fps.mp4',
    ],
  },
  {
    id: 'ai-4-talk',
    // Man in office talking to camera
    url: 'https://videos.pexels.com/video-files/8135878/8135878-sd_640_360_25fps.mp4',
    fallbacks: [
      'https://videos.pexels.com/video-files/8135878/8135878-sd_960_540_25fps.mp4',
      'https://videos.pexels.com/video-files/8135878/8135878-hd_1280_720_25fps.mp4',
    ],
  },
  {
    id: 'ai-5-talk',
    // Woman professional in office setting
    url: 'https://videos.pexels.com/video-files/7534793/7534793-sd_640_360_25fps.mp4',
    fallbacks: [
      'https://videos.pexels.com/video-files/7534793/7534793-sd_960_540_25fps.mp4',
      'https://videos.pexels.com/video-files/7534793/7534793-hd_1280_720_25fps.mp4',
      'https://videos.pexels.com/video-files/7534793/7534793-uhd_2560_1440_25fps.mp4',
    ],
  },
]

async function tryDownload(urls) {
  for (const url of urls) {
    try {
      const res = await fetch(url, { redirect: 'follow' })
      if (res.ok && res.headers.get('content-type')?.includes('video')) {
        return { buffer: Buffer.from(await res.arrayBuffer()), url }
      }
    } catch (e) {
      // try next
    }
  }
  return null
}

async function main() {
  console.log('Downloading stock video clips of professionals talking to camera...\n')

  for (const video of VIDEOS) {
    console.log(`Downloading ${video.id}...`)
    const allUrls = [video.url, ...video.fallbacks]
    const result = await tryDownload(allUrls)

    if (result) {
      const filePath = join(videosDir, `${video.id}.mp4`)
      await writeFile(filePath, result.buffer)
      console.log(`  ✓ ${video.id}.mp4 (${(result.buffer.length / 1024 / 1024).toFixed(1)} MB)`)
    } else {
      console.error(`  ✗ ${video.id} — all URLs failed`)
    }
  }

  console.log('\nDone! Videos saved to public/videos/')
}

main()
