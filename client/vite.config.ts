import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./tests/setup.ts",
    // Both extensions: component tests are .tsx, but a test with no JSX (the
    // api.ts error-message tests) is plain .ts and was silently not collected
    // while this only matched .tsx.
    include: ["tests/**/*.test.{ts,tsx}"],
  },
});
