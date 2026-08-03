import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          100: "#ece4d2",
          200: "#d4cbb9",
          300: "#b5ab9a",
          400: "#8f8475",
          500: "#6f6457",
          600: "#4f463c",
          700: "#3a322a",
          800: "#2a241e",
          850: "#221d18",
          900: "#1c1814",
          950: "#14110d",
        },
        claw: {
          100: "rgb(var(--accent-tint-rgb))",
          300: "rgb(var(--accent-light-rgb))",
          400: "rgb(var(--accent-2-rgb))",
          500: "rgb(var(--accent-rgb))",
          600: "rgb(var(--accent-strong-rgb))",
          // Contrast-safe pair for the accent — see the comment at the top of
          // src/index.css. `on` goes on top of a claw-500/600 fill; `text` is
          // the accent used as text on a page background.
          on: "rgb(var(--on-accent-rgb))",
          text: "rgb(var(--accent-text-rgb))",
        },
        cream: {
          50: "#faf6ef",
          100: "#f3ecdd",
          200: "#e8dec6",
          300: "#d6c79e",
        },
        moss: {
          400: "#8a9863",
          500: "#6a7a44",
        },
        plum: {
          500: "#7e5570",
          600: "#6b4560",
        },
        accent: {
          50: "#fffbeb",
          100: "#fef3c7",
          200: "#fde68a",
          300: "#fcd34d",
          400: "#fbbf24",
          500: "#f59e0b",
          600: "#d97706",
          700: "#b45309",
          800: "#92400e",
          900: "#78350f",
        },
      },
      fontFamily: {
        heading: ['"Plus Jakarta Sans Variable"', "system-ui", "sans-serif"],
        sans: ['"Plus Jakarta Sans Variable"', "system-ui", "-apple-system", "BlinkMacSystemFont", '"Segoe UI"', "sans-serif"],
      },
      fontSize: {
        // Supporting metadata (year, genre chips, episode counts) leans on this
        // token across nearly every card. Held at a 12px floor for legibility —
        // kept as a distinct token so dense metadata can carry tighter tracking
        // than body `xs` without dropping below the readable minimum.
        "2xs": ["0.75rem", { lineHeight: "1rem" }],
      },
      aspectRatio: {
        poster: "2 / 3",
      },
      borderRadius: {
        "2xl": "1rem",
        "3xl": "1.5rem",
      },
      boxShadow: {
        glow: "0 0 20px rgba(217, 119, 66, 0.12)",
        "card-hover": "0 8px 20px rgba(28, 24, 20, 0.08)",
        feature: "0 12px 28px rgba(28, 24, 20, 0.18)",
      },
    },
  },
  plugins: [],
} satisfies Config;
