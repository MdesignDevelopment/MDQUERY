import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        panel: 'var(--panel)',
        'panel-2': 'var(--panel-2)',
        edge: 'var(--edge)',
        ink: 'var(--ink)',
        'ink-dim': 'var(--ink-dim)',
        'ink-faint': 'var(--ink-faint)',
        accent: 'var(--accent)',
        'accent-hi': 'var(--accent-hi)',
        'risk-safe': 'var(--risk-safe)',
        'risk-warn': 'var(--risk-warn)',
        'risk-high': 'var(--risk-high)',
      },
      fontFamily: {
        mono: ['ui-monospace', 'Cascadia Code', 'Consolas', 'Menlo', 'monospace'],
        sans: ['-apple-system', 'Segoe UI', 'system-ui', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
export default config;
