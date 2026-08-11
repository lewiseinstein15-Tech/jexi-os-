export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // Surfaces (elevation by shade, not shadow)
        void: '#030303',
        'surface-1': '#0A0A0B',
        'surface-2': '#111113',
        'surface-3': '#18181B',
        hairline: 'rgba(255,255,255,0.06)',
        'hairline-strong': 'rgba(255,255,255,0.10)',
        // Text
        'text-primary': '#F5F5F7',
        'text-secondary': '#A1A1AA',
        'text-tertiary': '#616166',
        // Brand / signal (single accent)
        brand: '#00FF9D',
        'brand-dim': 'rgba(0,255,157,0.20)',
        'brand-line': 'rgba(0,255,157,0.40)',
        // Agent / semantic palette — identity + status only
        'agent-planner': '#22D3EE',
        'agent-coder': '#00FF9D',
        'agent-qa': '#FBBF24',
        'agent-security': '#FB7185',
        'agent-research': '#A78BFA',
        'agent-vision': '#F472B6',
        // Status
        'status-online': '#00FF9D',
        'status-warn': '#FBBF24',
        'status-error': '#FB7185',
        'status-idle': '#616166',
        jexi: '#00FF9D',
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
