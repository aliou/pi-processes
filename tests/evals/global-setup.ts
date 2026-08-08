import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const evalsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(evalsDir, "..", "..");
const agentDir = join(evalsDir, "agent-dir");

/**
 * Pi resolves eval models from `<agentDir>/models.json`, a plain file with no
 * environment-variable interpolation. The Aperture base URL is private, so the
 * file cannot be committed. Generate it at run time instead, from `.env.test`.
 */
export default async function setup(): Promise<void> {
  // Real environment wins over .env.test, so CI secrets override local files.
  const envFile = join(repoRoot, ".env.test");
  if (existsSync(envFile) && !process.env.APERTURE_BASE_URL) {
    process.loadEnvFile(envFile);
  }

  const baseUrl = process.env.APERTURE_BASE_URL?.trim();
  const apiKey = process.env.APERTURE_API_KEY?.trim() || "-";

  if (!baseUrl) {
    throw new Error(
      [
        "APERTURE_BASE_URL is not set, so eval models cannot be resolved.",
        "Copy .env.test.example to .env.test and fill in your Aperture base URL,",
        "or export APERTURE_BASE_URL in the environment (CI uses a secret).",
      ].join(" "),
    );
  }

  const modelsConfig = {
    providers: {
      aperture: {
        name: "Aperture",
        api: "openai-completions",
        baseUrl,
        apiKey,
        models: [
          {
            id: "syn:small:text",
            name: "Aperture Small (text)",
            input: ["text"],
            reasoning: false,
            contextWindow: 262144,
            // Capped deliberately: evals should never run away with output.
            maxTokens: 4096,
          },
          {
            id: "syn:large:text",
            name: "Aperture Large (text)",
            input: ["text"],
            reasoning: false,
            contextWindow: 524288,
            maxTokens: 8192,
          },
        ],
      },
    },
  };

  await mkdir(agentDir, { recursive: true });
  await writeFile(
    join(agentDir, "models.json"),
    `${JSON.stringify(modelsConfig, null, 2)}\n`,
    "utf8",
  );
}
