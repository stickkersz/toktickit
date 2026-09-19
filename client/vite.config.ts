import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// Lab 3 (ADR 0001): the API is reached through this proxy, so the browser only
// ever talks to the Vite origin. That keeps the session cookie first-party and
// avoids SameSite=None plus Secure, which plain-HTTP local development cannot
// satisfy. 127.0.0.1, never localhost: an unrelated process on some machines
// binds [::1]:3001, so "localhost" can resolve to the wrong app.
const DEFAULT_API_TARGET = "http://127.0.0.1:3000";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const target = process.env.VITE_API_PROXY_TARGET ?? env.VITE_API_PROXY_TARGET ?? DEFAULT_API_TARGET;

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: { "/api": { target } },
    },
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: "./tests/setup.ts",
      // Both extensions: component tests are .tsx, but a test with no JSX (the
      // api.ts error-message tests) is plain .ts and was silently not collected
      // while this only matched .tsx.
      include: ["tests/**/*.test.{ts,tsx}"],
    },
  };
});
