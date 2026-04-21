import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        'teams-bg': '#f5f5f5',
        'teams-dark': '#242424',
        'teams-sidebar': '#ebebeb',
        'teams-toolbar': '#ffffff',
        'teams-purple': '#5b5fc7',
        'teams-purple-dark': '#4b4fad',
        'teams-red': '#c4314b',
        'teams-red-hover': '#a72b40',
        'teams-hover': '#e8e8e8',
        'teams-border': '#e0e0e0',
        'teams-meeting-bg': '#292929',
        'teams-icon': '#616161',
        'teams-text': '#242424',
        'teams-text-secondary': '#616161',
        'teams-notification': '#f5f5f5',
      },
    },
  },
  plugins: [],
}
export default config
