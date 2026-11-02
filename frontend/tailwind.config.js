/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#17211b',
        muted: '#66736a',
        canvas: '#f6f7f4',
        accent: '#247a55',
        'accent-dark': '#175c3e',
      },
      boxShadow: {
        card: '0 12px 32px rgba(27, 44, 34, 0.07)',
      },
    },
  },
  plugins: [],
};
