import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Client unit tests (pure functions) run here too, so the client needs no
    // test dependency of its own.
    include: ["tests/**/*.test.ts", "../client/src/**/*.test.ts"],
    // Starts the in-memory MongoDB replica set shared by all tests.
    globalSetup: ["tests/globalSetup.ts"],
    // Database tests run real transactions; give them room on slow machines.
    testTimeout: 20_000,
    hookTimeout: 120_000,
    // Keeps test logs quiet and makes sure tests never pick up a real API key
    // or a real database (tests connect to the in-memory one explicitly).
    env: {
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      ANTHROPIC_API_KEY: "",
      MONGODB_URI: "mongodb://not-used-by-tests",
    },
  },
});
