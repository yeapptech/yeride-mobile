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
        // card / muted / border / honey moved to CSS-variable tokens (global.css)
        // so they theme via prefers-color-scheme without per-screen `dark:` variants.
        card: {
          DEFAULT: 'rgb(var(--card) / <alpha-value>)',
          foreground: 'rgb(var(--card-foreground) / <alpha-value>)',
        },
        muted: {
          DEFAULT: 'rgb(var(--muted) / <alpha-value>)',
          foreground: 'rgb(var(--muted-foreground) / <alpha-value>)',
        },
        border: 'rgb(var(--border) / <alpha-value>)',
        honey: {
          DEFAULT: 'rgb(var(--honey) / <alpha-value>)',
          foreground: 'rgb(var(--honey-foreground) / <alpha-value>)',
        },
      },
    },
  },
  plugins: [],
};
