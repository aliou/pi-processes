import { spawn } from "node:child_process";
import {
  createEventBus,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionToolContext,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import type { SettingsListTheme } from "@earendil-works/pi-tui";
import { createMock } from "@golevelup/ts-vitest";
import { vol } from "memfs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configLoader } from "./config";
import extension from "./index";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
  return {
    ...actual,
    getAgentDir: () => "/agent",
    getSettingsListTheme: () => createMock<SettingsListTheme>(),
  };
});

const projectPath = "/repo/.pi/extensions/processes.json";
const projectConfig = JSON.stringify({
  execution: { shellPath: "/repo/shell" },
  interception: { blockBackgroundCommands: false },
});

type Handler = (event: never, ctx: never) => unknown;

async function setup(trusted: boolean, globalConfig = true, cwd = "/repo") {
  vol.fromJSON({
    [projectPath]: projectConfig,
    "/repo/shell": "",
    "/bin/bash": "",
    "/global/shell": "",
    ...(globalConfig
      ? {
          "/agent/extensions/processes.json": JSON.stringify({
            execution: { shellPath: "/global/shell" },
            interception: { blockBackgroundCommands: true },
          }),
        }
      : {}),
  });
  const handlers = new Map<string, Handler[]>();
  const pi = createMock<ExtensionAPI>({
    events: createEventBus(),
    on: vi.fn((event: string, handler: Handler) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      return () => {};
    }) as ExtensionAPI["on"],
  });
  const ctx = createMock<ExtensionToolContext>({
    cwd,
    hasUI: true,
    isProjectTrusted: () => trusted,
  });
  await extension(pi);
  const fire = async (event: string) => {
    for (const handler of handlers.get(event) ?? []) {
      await handler({} as never, ctx as never);
    }
  };
  const start = async () => {
    const tool = vi.mocked(pi.registerTool).mock.calls[0][0];
    await expect(
      tool.execute(
        "start-1",
        { action: "start", name: "test-1", command: "true" },
        undefined,
        undefined,
        ctx,
      ),
    ).rejects.toThrow("spawn stopped");
  };
  return { pi, ctx, configLoader, handlers, fire, start };
}

beforeEach(() => {
  configLoader.drainMessages();
  vi.spyOn(process, "cwd").mockReturnValue("/repo");
  vi.mocked(spawn).mockImplementation(() => {
    throw new Error("spawn stopped");
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("project config", () => {
  it("leaves project files unchanged during setup", async () => {
    const { configLoader } = await setup(false);
    expect(String(vol.readFileSync(projectPath))).toBe(projectConfig);
    await expect(configLoader.save("local", {})).rejects.toThrow();
  });

  it.each([true, false])(
    "keeps untrusted shell settings out of process starts (global: %s)",
    async (globalConfig) => {
      const { fire, start, ctx, configLoader, handlers } = await setup(
        false,
        globalConfig,
      );
      await start();
      expect(spawn).toHaveBeenLastCalledWith(
        globalConfig ? "/global/shell" : "/bin/bash",
        ["-lc", "true"],
        expect.anything(),
      );
      await fire("session_start");
      await start();
      expect(spawn).toHaveBeenLastCalledWith(
        globalConfig ? "/global/shell" : "/bin/bash",
        ["-lc", "true"],
        expect.anything(),
      );
      expect(String(vol.readFileSync(projectPath))).toBe(projectConfig);
      expect(ctx.ui.notify).toHaveBeenCalledTimes(1);
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        expect.stringContaining(`Ignored ${projectPath}: project not trusted`),
        "info",
      );
      expect(configLoader.drainMessages()).toEqual([]);
      const blocker = handlers.get("tool_call")?.[0];
      const result = await blocker?.(
        { toolName: "bash", input: { command: "sleep 10 &" } } as never,
        ctx as never,
      );
      expect(result).toEqual(
        globalConfig ? expect.objectContaining({ block: true }) : undefined,
      );
      await expect(configLoader.save("local", {})).rejects.toThrow();
    },
  );

  it("applies trusted project settings to runtime reads", async () => {
    const { fire, start, ctx, configLoader, handlers } = await setup(true);
    await fire("session_start");
    await start();
    expect(spawn).toHaveBeenCalledWith(
      "/repo/shell",
      ["-lc", "true"],
      expect.anything(),
    );
    const blocker = handlers.get("tool_call")?.[0];
    const result = await blocker?.(
      { toolName: "bash", input: { command: "sleep 10 &" } } as never,
      ctx as never,
    );
    expect(result).toBeUndefined();
    expect(configLoader.getConfig().interception.blockBackgroundCommands).toBe(
      false,
    );
    expect(String(vol.readFileSync(projectPath))).not.toBe(projectConfig);
  });

  it("shows a read-only Local settings tab for an untrusted project", async () => {
    const { pi, ctx, fire } = await setup(false);
    await fire("session_start");
    vi.mocked(ctx.ui.custom).mockImplementation(async (factory) => {
      const theme = createMock<Theme>({
        fg: (_color, text) => text,
        bg: (_color, text) => text,
        bold: (text) => text,
      });
      const panel = await factory(createMock(), theme, createMock(), vi.fn());
      const rendered = panel.render(100).join("\n");
      expect(rendered).toContain("Project not trusted");
      expect(rendered).toContain(projectPath);
      expect(rendered).toContain("Use /trust and restart Pi");
      expect(rendered).not.toContain("Ctrl+S save");
      expect(rendered).not.toContain("Enter/Space change");
      panel.handleInput?.(" ");
      panel.handleInput?.("\u0013");
      return undefined;
    });
    const command = vi
      .mocked(pi.registerCommand)
      .mock.calls.find(([name]) => name === "ps:settings");
    expect(command).toBeDefined();
    await command?.[1].handler(
      "local",
      createMock<ExtensionCommandContext>({ hasUI: true, ui: ctx.ui }),
    );
    expect(ctx.ui.custom).toHaveBeenCalledOnce();
    expect(String(vol.readFileSync(projectPath))).toBe(projectConfig);
  });

  it("resolves project settings from the session directory", async () => {
    const { fire, configLoader } = await setup(true, true, "/other");
    vol.fromJSON({
      "/other/.pi/extensions/processes.json": JSON.stringify({
        execution: { shellPath: "/other/shell" },
      }),
    });
    await fire("session_start");
    expect(configLoader.getConfig().execution.shellPath).toBe("/other/shell");
    expect(String(vol.readFileSync(projectPath))).toBe(projectConfig);
  });

  it("preserves memory settings when applying trusted project settings", async () => {
    const { fire, configLoader } = await setup(true);
    await configLoader.save("memory", {
      execution: { shellPath: "/memory/shell" },
    });
    await fire("session_start");
    expect(configLoader.getConfig().execution.shellPath).toBe("/memory/shell");
  });
});
