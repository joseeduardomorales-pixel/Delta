/** @type {import('tailwindcss').Config} */
// Delta — Tailwind config (UI Developer cameo).
// Matrix palette + JetBrains Mono. Mobile-first; tap targets >=44px.
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        matrix: {
          black: '#000000',
          green: '#00FF41',
          'green-dim': '#00B82E',
          'green-faint': 'rgba(0, 255, 65, 0.12)',
          'green-line': 'rgba(0, 255, 65, 0.25)',
          red: '#FF3B3B',
          amber: '#FFB300',
          fg: '#E6FFEC',
          'fg-dim': '#8FBFA0',
          'fg-muted': '#4A6B53',
        },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular',
               'Menlo', 'Consolas', 'monospace'],
        sans: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular',
               'Menlo', 'Consolas', 'monospace'],
      },
      minHeight: { tap: '44px' },
      minWidth: { tap: '44px' },
      spacing: { tap: '44px' },
      borderRadius: { sm: '4px', md: '8px', lg: '12px' },
      boxShadow: {
        'matrix-glow': '0 0 12px rgba(0, 255, 65, 0.35)',
        'matrix-glow-strong': '0 0 24px rgba(0, 255, 65, 0.55)',
      },
      transitionDuration: { fast: '120ms', base: '200ms' },
    },
    // Mobile-first breakpoints. Default screens are already mobile-first
    // (min-width based); keep them explicit for charter clarity.
    screens: {
      sm: '480px',
      md: '768px',
      lg: '1024px',
      xl: '1280px',
    },
  },
  plugins: [
    // ./tap utility — semantic alias for "this element is a touch target"
    function tapTargetPlugin({ addUtilities }) {
      addUtilities({
        '.tap': {
          'min-height': '44px',
          'min-width': '44px',
          display: 'inline-flex',
          'align-items': 'center',
          'justify-content': 'center',
        },
      });
    },
  ],
};
