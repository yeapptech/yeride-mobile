/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  darkMode: 'media',
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        // CSS-variable tokens use channel form (`R G B` triplets in global.css)
        // wrapped here as `rgb(var(--token) / <alpha-value>)` so opacity
        // modifiers like `bg-success/10` work via Tailwind's <alpha-value> sub.
        background: 'rgb(var(--background) / <alpha-value>)',
        foreground: 'rgb(var(--foreground) / <alpha-value>)',
        primary: 'rgb(var(--primary) / <alpha-value>)',
        'primary-foreground': 'rgb(var(--primary-foreground) / <alpha-value>)',
        'brand-deep': 'rgb(var(--brand-deep) / <alpha-value>)',
        'brand-warm': 'rgb(var(--brand-warm) / <alpha-value>)',
        'brand-muted': 'rgb(var(--brand-muted) / <alpha-value>)',
        success: 'rgb(var(--success) / <alpha-value>)',
        warning: 'rgb(var(--warning) / <alpha-value>)',
        error: 'rgb(var(--error) / <alpha-value>)',
        info: 'rgb(var(--info) / <alpha-value>)',
        card: {
          DEFAULT: '#ffffff',
          foreground: '#000000',
          dark: '#1f1f1f',
          'dark-foreground': '#ffffff',
        },
        muted: {
          DEFAULT: '#f5f5f5',
          foreground: '#737373',
          dark: '#2a2a2a',
          'dark-foreground': '#a3a3a3',
        },
        border: {
          DEFAULT: '#e5e5e5',
          dark: '#404040',
        },
      },
    },
  },
  plugins: [],
};
