import type { Config } from "tailwindcss";
import { createPreset } from "fumadocs-ui/tailwind-plugin";

const config: Config = {
  darkMode: ["class"],
  presets: [createPreset()],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./content/**/*.mdx",
    "./mdx-components.tsx",
    "./node_modules/fumadocs-ui/dist/**/*.js",
  ],
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        "accent-2": {
          DEFAULT: "hsl(var(--accent-2))",
          foreground: "hsl(var(--accent-2-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        // Severity colors
        fatal: "hsl(var(--fatal))",
        error: "hsl(var(--error))",
        warning: "hsl(var(--warning))",
        info: "hsl(var(--info))",
        // Brand colors
        bug: {
          DEFAULT: "hsl(var(--bug))",
          foreground: "hsl(var(--bug-foreground))",
        },
        surface: {
          1: "hsl(var(--surface-1))",
          2: "hsl(var(--surface-2))",
          3: "hsl(var(--surface-3))",
        },
        "border-subtle": "hsl(var(--border-subtle))",
        "border-strong": "hsl(var(--border-strong))",
      },
      borderRadius: {
        xl: "16px",
        lg: "12px",
        md: "8px",
        sm: "6px",
        pill: "100px",
      },
      spacing: {
        '18': '4.5rem',
        '22': '5.5rem',
        '26': '6.5rem',
        '30': '7.5rem',
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)"],
        mono: ["var(--font-geist-mono)"],
        display: ["var(--font-display)", "var(--font-geist-sans)", "system-ui", "sans-serif"],
      },
      fontSize: {
        "display-xl": ["72px", { lineHeight: "1.05", letterSpacing: "-0.03em", fontWeight: "700" }],
        "display-lg": ["56px", { lineHeight: "1.1", letterSpacing: "-0.025em", fontWeight: "700" }],
        "display-md": ["44px", { lineHeight: "1.15", letterSpacing: "-0.02em", fontWeight: "700" }],
        "heading-lg": ["32px", { lineHeight: "1.2", letterSpacing: "-0.015em", fontWeight: "600" }],
        "heading-md": ["24px", { lineHeight: "1.3", letterSpacing: "-0.01em", fontWeight: "600" }],
        "heading-sm": ["18px", { lineHeight: "1.4", fontWeight: "600" }],
        "body-lg": ["17px", { lineHeight: "1.6" }],
        body: ["15px", { lineHeight: "1.55" }],
        "body-sm": ["13px", { lineHeight: "1.5" }],
        caption: ["12px", { lineHeight: "1.4", letterSpacing: "0.01em" }],
        "mono-sm": ["13px", { lineHeight: "1.5" }],
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "token-pop": {
          "0%": { transform: "scale(0.8)", opacity: "0" },
          "50%": { transform: "scale(1.05)" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
        "highlight-pulse": {
          "0%": { backgroundColor: "hsl(var(--primary) / 0.2)" },
          "100%": { backgroundColor: "transparent" },
        },
        "slide-in-new": {
          "0%": { transform: "translateY(-8px)", opacity: "0", backgroundColor: "hsl(var(--primary) / 0.08)" },
          "50%": { backgroundColor: "hsl(var(--primary) / 0.05)" },
          "100%": { transform: "translateY(0)", opacity: "1", backgroundColor: "transparent" },
        },
        "fade-in-up": {
          "0%": { transform: "translateY(4px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        "count-up": {
          "0%": { transform: "scale(1)" },
          "50%": { transform: "scale(1.05)" },
          "100%": { transform: "scale(1)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "token-pop": "token-pop 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)",
        "highlight-pulse": "highlight-pulse 0.3s ease-out",
        "slide-in-new": "slide-in-new 0.5s ease-out",
        "fade-in-up": "fade-in-up 0.3s ease-out",
        "count-up": "count-up 0.3s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
