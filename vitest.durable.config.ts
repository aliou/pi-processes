import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["durable/**/*.test.ts"],
    mockReset: true,
    testTimeout: 10_000,
  },
});
