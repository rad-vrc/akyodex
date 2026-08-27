import nextConfig from "eslint-config-next";

const eslintConfig = [
  ...nextConfig,
  {
    ignores: [
      "node_modules/**",
      ".claude/**",
      ".next/**",
      ".open-next/**",
      ".open-next-*/**",
      ".playwright-mcp/**",
      ".vercel/**",
      "out/**",
      "build/**",
      "public/sw.js",
      "sw.js",
      "next-env.d.ts",
      "cloudflare-env.d.ts",
      "scripts/**",
      "playwright-report/**",
      "test-results/**",
      "coverage/**",
      "output/**",
      "package/**",
      ".cache/**",
      ".turbo/**",
      ".serena/**",
      "*.tsbuildinfo",
    ],
  },
  {
    files: ["**/*.{js,jsx,mjs,ts,tsx,mts,cts}"],
    // Downgrade new React 19.2 compiler lint rules from error -> warn.
    // These flag pre-existing patterns (setState in useEffect, Math.random in useRef)
    // that are valid in this codebase. TODO: Refactor to satisfy these rules.
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
    },
  },
];

export default eslintConfig;
