/** @type {import('tailwindcss').Config} */
// Delta — Tailwind config, Minimalist Modern v2.
// See docs/design-system-v2.md for the authoritative spec.

export default {
  // Gate every `hover:` Tailwind utility behind `@media (hover: hover)` so
  // touch devices don't synthesize a hover state on the first tap (which
  // caused two-tap activations on Cards, links, and buttons across the app).
  // Mouse devices still get hover effects.
  future: { hoverOnlyWhenSupported: true },
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: 'var(--background)',
        card: 'var(--card)',
        foreground: 'var(--foreground)',
        muted: {
          DEFAULT: 'var(--muted)',
          foreground: 'var(--muted-foreground)',
        },
        border: 'var(--border)',
        ring: 'var(--ring)',
        accent: {
          DEFAULT: 'var(--accent)',
          secondary: 'var(--accent-secondary)',
          foreground: 'var(--accent-foreground)',
          bg: 'var(--accent-bg)',
          'bg-strong': 'var(--accent-bg-strong)',
          border: 'var(--accent-border)',
        },
        success: {
          DEFAULT: 'var(--success)',
          bg: 'var(--success-bg)',
        },
        warning: {
          DEFAULT: 'var(--warning)',
          bg: 'var(--warning-bg)',
        },
        danger: {
          DEFAULT: 'var(--danger)',
          bg: 'var(--danger-bg)',
        },
        info: {
          DEFAULT: 'var(--info)',
          bg: 'var(--info-bg)',
        },
      },
      fontFamily: {
        display: ['Calistoga', 'Georgia', 'Times New Roman', 'serif'],
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: [
          'JetBrains Mono',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Consolas',
          'monospace',
        ],
      },
      fontSize: {
        // Display sits between text-5xl and text-6xl — calibrated for Login hero.
        display: [
          '3rem',
          { lineHeight: '1.05', letterSpacing: '-0.02em', fontWeight: '400' },
        ],
      },
      minHeight: { tap: 'var(--tap-target)' },
      minWidth: { tap: 'var(--tap-target)' },
      spacing: { tap: 'var(--tap-target)' },
      borderRadius: {
        sm: 'var(--radius-sm)',
        DEFAULT: 'var(--radius-md)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
        '2xl': 'var(--radius-2xl)',
      },
      boxShadow: {
        sm: 'var(--shadow-sm)',
        DEFAULT: 'var(--shadow-md)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
        xl: 'var(--shadow-xl)',
        accent: 'var(--shadow-accent)',
        'accent-lg': 'var(--shadow-accent-lg)',
      },
      transitionDuration: {
        fast: '120ms',
        base: '200ms',
        slow: '400ms',
      },
      transitionTimingFunction: {
        'ease-out-soft': 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
      backgroundImage: {
        'gradient-accent': 'linear-gradient(to right, var(--accent), var(--accent-secondary))',
        'gradient-accent-diagonal':
          'linear-gradient(135deg, var(--accent), var(--accent-secondary))',
      },
      keyframes: {
        'pulse-dot': {
          '0%, 100%': { transform: 'scale(1)', opacity: '1' },
          '50%': { transform: 'scale(1.3)', opacity: '0.7' },
        },
        'spin-slow': {
          to: { transform: 'rotate(360deg)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
      },
      animation: {
        'pulse-dot': 'pulse-dot 2s ease-in-out infinite',
        'spin-slow': 'spin-slow 60s linear infinite',
        float: 'float 5s ease-in-out infinite',
      },
    },
    // Mobile-first breakpoints — unchanged from Phase 1.
    screens: {
      sm: '480px',
      md: '768px',
      lg: '1024px',
      xl: '1280px',
    },
  },
  plugins: [
    // ./tap utility kept for back-compat / semantic intent
    function tapTargetPlugin({ addUtilities }) {
      addUtilities({
        '.tap': {
          'min-height': 'var(--tap-target)',
          'min-width': 'var(--tap-target)',
          display: 'inline-flex',
          'align-items': 'center',
          'justify-content': 'center',
        },
      });
    },
  ],
};
