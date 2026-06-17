import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "extensions/**/*.test.ts"],
    setupFiles: ["./tests/setup-mocks.ts"],
    mockReset: true,
  },
});
