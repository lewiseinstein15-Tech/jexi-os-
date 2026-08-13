export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // Surfaces — near-black blue/graphite (elevation by shade)
        void: '#090A0E',
        'surface-1': '#0C1117',
        'surface-2': '#111820',
        'surface-3': '#161F29',
        hairline: 'rgba(255,255,255,0.06)',
        'hairline-strong': 'rgba(255,255,255,0.10)',
        // Text
        'text-primary': '#E8EDF2',
        'text-secondary': '#7C8794',
        'text-tertiary': '#46515D',
        // Brand / signal (single green)
        brand: '#00D26A',
        'brand-dim': 'rgba(0,210,106,0.18)',
        'brand-line': 'rgba(0,210,106,0.38)',
        // Semantic accents — capability identity + status only
        'acc-research': '#4A9EFF',
        'acc-code': '#00D26A',
        'acc-math': '#B36CFF',
        'acc-engineering': '#FF9B3D',
        'acc-analysis': '#22D3EE',
        'acc-automation': '#D8A83E',
        // Agent palette — identity + status only
        'agent-planner': '#4A9EFF',
        'agent-coder': '#00D26A',
        'agent-qa': '#FF9B3D',
        'agent-security': '#FB7185',
        'agent-research': '#B36CFF',
        'agent-vision': '#22D3EE',
        // Status
        'status-online': '#00D26A',
        'status-warn': '#D8A83E',
        'status-error': '#FB7185',
        'status-idle': '#46515D',
        jexi: '#00D26A',
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      borderRadius: {
        sm: '8px',
        md: '12px',
        lg: '16px',
        xl: '20px',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        shimmer: 'shimmer 1.5s ease-in-out infinite',
        'spin-slow': 'spin 3s linear infinite',
        'bounce-dot': 'bounceDot 0.6s ease-in-out infinite',
      },
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '200% 0' },
          '100%': { backgroundPosition: '-200% 0' },
        },
        bounceDot: {
          '0%, 80%, 100%': { transform: 'translateY(0)', opacity: '0.5' },
          '40%': { transform: 'translateY(-4px)', opacity: '1' },
        },
      },
    },
  },
  plugins: [],
}
