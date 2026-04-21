/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone', // Required for Railway/Docker deployment
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
    proxyTimeout: 7200000, // 2h proxy timeout for long API calls
  },
  httpAgentOptions: {
    keepAlive: true,
  },
}

module.exports = nextConfig
