import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Keeps test logs quiet and makes sure tests never pick up a real API key.
    env: { NODE_ENV: "test", LOG_LEVEL: "silent", ANTHROPIC_API_KEY: "" },
  },
});
