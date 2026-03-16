import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef6ff",
          100: "#d9ebff",
          200: "#bcdcff",
          300: "#8ec6ff",
          400: "#59a5ff",
          500: "#3b82f6",
          600: "#2563eb",
          700: "#1d4fd8",
          800: "#1e40af",
          900: "#1e3a8a",
        },
        accent: {
          50: "#fdf4ff",
          100: "#fae8ff",
          200: "#f5d0fe",
          300: "#e879f9",
          400: "#d946ef",
          500: "#c026d3",
          600: "#a21caf",
          700: "#86198f",
          800: "#701a75",
          900: "#4a044e",
        },
      },
      fontFamily: {
        heading: ['"Plus Jakarta Sans Variable"', "Inter", "system-ui", "sans-serif"],
        sans: ["Inter", "system-ui", "-apple-system", "BlinkMacSystemFont", '"Segoe UI"', "sans-serif"],
      },
      fontSize: {
        "2xs": ["0.625rem", { lineHeight: "0.875rem" }],
      },
      aspectRatio: {
        poster: "2 / 3",
      },
    },
  },
  plugins: [],
} satisfies Config;
