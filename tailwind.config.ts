import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: "#18212f",
        mist: "#f5f7fb",
        line: "#dfe6ef",
        brand: {
          50: "#eefcf9",
          100: "#d4f7ef",
          500: "#11a88d",
          600: "#078b77",
          700: "#066e61"
        },
        navy: "#23364f",
        amber: "#f59e0b"
      },
      boxShadow: {
        soft: "0 18px 45px rgba(24, 33, 47, 0.08)"
      }
    }
  },
  plugins: []
};

export default config;
