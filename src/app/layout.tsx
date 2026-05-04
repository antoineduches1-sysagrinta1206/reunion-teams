import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Microsoft Teams Meeting',
  description: 'Meeting in progress',
  openGraph: {
    title: 'Microsoft Teams Meeting',
    description: 'Meeting in progress',
    siteName: 'Microsoft Teams',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  )
}
