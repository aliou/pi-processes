import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const evalsDir = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

// Evals resolve models through `ModelRuntime.create()` with no arguments, which
// reads auth.json/models.json from the agent dir. Force a dedicated dir so runs
// never depend on (or spend from) the developer's real ~/.pi/agent, and so
// extension-registered providers are irrelevant.
const evalAgentDir = `${evalsDir}agent-dir`;

export default defineConfig({
  // Keep the repo root so CLI path filters stay repo-relative, e.g.
  // `pnpm test:evals tests/evals/smoke.eval.ts`.
  root: repoRoot,
  test: {
    include: ["tests/evals/**/*.eval.ts"],
    // Writes tests/evals/agent-dir/models.json from .env.test / the environment.
    globalSetup: ["./tests/evals/global-setup.ts"],
    env: {
      PI_CODING_AGENT_DIR: evalAgentDir,
      // Pinned here rather than inherited, so an ambient PI_PROVIDER/PI_MODEL
      // cannot silently redirect evals at a paid account.
      // Override with PI_EVAL_PROVIDER / PI_EVAL_MODEL.
      PI_PROVIDER: process.env.PI_EVAL_PROVIDER ?? "aperture",
      PI_MODEL: process.env.PI_EVAL_MODEL ?? "syn:small:text",
    },
    // Evals drive a real model through a real AgentSession: no global mocks,
    // long timeouts, and low concurrency to stay within provider rate limits.
    testTimeout: 300_000,
    hookTimeout: 60_000,
    maxConcurrency: 1,
    fileParallelism: false,
    retry: 0,
  },
});
