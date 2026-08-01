import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getModel } from "@earendil-works/pi-ai";
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import initExtension from "./index";

describe("process prefix stability", () => {
  let tempDir: string | undefined;

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  it("keeps the system prompt byte-identical across process lifecycle changes", async () => {
    tempDir = join(
      tmpdir(),
      `pi-processes-prefix-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    const agentDir = join(tempDir, "agent");
    mkdirSync(agentDir, { recursive: true });

    const settingsManager = SettingsManager.create(tempDir, agentDir);
    const sessionManager = SessionManager.inMemory();
    const resourceLoader = new DefaultResourceLoader({
      cwd: tempDir,
      agentDir,
      settingsManager,
      extensionFactories: [initExtension],
    });
    await resourceLoader.reload();

    const model = getModel("anthropic", "claude-sonnet-4-5");
    expect(model).toBeDefined();
    if (!model) throw new Error("test model unavailable");

    const { session } = await createAgentSession({
      cwd: tempDir,
      agentDir,
      model,
      settingsManager,
      sessionManager,
      resourceLoader,
    });

    try {
      await session.bindExtensions({});
      const processTool = session.getToolDefinition("process");
      expect(processTool).toBeDefined();
      if (!processTool) throw new Error("process tool not registered");

      const baseline = session.systemPrompt;
      const signal = new AbortController().signal;
      const context = { cwd: tempDir } as never;

      await processTool.execute(
        "prefix-start",
        { action: "start", name: "prefix-probe", command: "sleep 0.05" },
        signal,
        undefined,
        context,
      );
      expect(session.systemPrompt).toBe(baseline);

      await processTool.execute(
        "prefix-list",
        { action: "list" },
        signal,
        undefined,
        context,
      );
      expect(session.systemPrompt).toBe(baseline);

      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(session.systemPrompt).toBe(baseline);
    } finally {
      await session.dispose();
    }
  });
});
