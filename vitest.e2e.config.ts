import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/e2e/**/*.e2e.ts"],
    mockReset: true,
    testTimeout: 10_000,
  },
});
