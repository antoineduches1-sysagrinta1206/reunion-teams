import { execSync } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const ffmpegPath = require('ffmpeg-static')
const __dirname = path.dirname(fileURLToPath(import.meta.url))

const videoPath = path.join(__dirname, '..', 'public', 'videos', 'video_2026-04-08_09-35-04.mp4')
const outputPath = path.join(__dirname, '..', 'public', 'faces', 'user-face.jpg')

console.log('Extracting frame from video...')
console.log('Video:', videoPath)
console.log('FFmpeg:', ffmpegPath)

execSync(`"${ffmpegPath}" -i "${videoPath}" -ss 00:00:01 -vframes 1 -q:v 2 "${outputPath}" -y`, { stdio: 'inherit' })
console.log('Done! Saved to:', outputPath)
