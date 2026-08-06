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
        // Status text, themed — the Tailwind-side names for the --status-*
        // trio, so `text-danger` and `style={{ color: "var(--status-bad)" }}`
        // are the same colour rather than two that drift. See the note above
        // those tokens in src/index.css for why a fixed `text-rose-600` can't
        // do this job across five themes.
        danger: "var(--status-bad)",
        success: "var(--status-ok)",
        warning: "var(--status-warn)",
        // The focus indicator, which answers SC 1.4.11's 3:1 rather than
        // 1.4.3's 4.5:1 — `ring-focus` everywhere a control takes a ring.
        focus: "var(--focus-ring)",
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
      // The dashboard's repeating grid unit — see the --poster-card-w note in
      // src/index.css. Pointed at the variable rather than restating the value
      // so `w-poster-card` and the arbitrary grid templates that need the raw
      // var stay one definition.
      spacing: {
        "poster-card": "var(--poster-card-w)",
      },
      // Three ranks of surface, three radii — see the "Radius ranks" note in
      // src/index.css for which surface takes which.
      borderRadius: {
        "2xl": "1rem",
        "3xl": "1.5rem",
      },
      // Elevation. Three tiers, themed — the values live on :root in
      // src/index.css so the dark themes can trade warm-black for real black
      // instead of casting a shadow nobody can see. `glow` is the accent halo
      // under a primary button, not an elevation.
      boxShadow: {
        e1: "var(--elevation-1)",
        e2: "var(--elevation-2)",
        e3: "var(--elevation-3)",
        glow: "var(--elevation-glow)",
      },
      // Three tiers of motion, same source of truth as the CSS below. `base`
      // matches the 200ms the base layer gives every button, link and input,
      // so a control that opts into `transition-all` eases at the same rate as
      // the one beside it that didn't.
      transitionDuration: {
        fast: "var(--duration-fast)",
        base: "var(--duration-base)",
        slow: "var(--duration-slow)",
      },
    },
  },
  plugins: [],
} satisfies Config;
