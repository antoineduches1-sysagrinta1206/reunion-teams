/** @type {import('next').NextConfig} */
const nextConfig = {
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
