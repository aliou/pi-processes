import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { vol } from "memfs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { importLegacyProcessConfig } from "./000-import-legacy-process-config";

// Preserve any other named exports the package exposes, so a future change to
// the SUT's imports doesn't silently hit `undefined`.
vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
  return { ...actual, getAgentDir: vi.fn(() => "/fake/agent") };
});

const agentDir = () => getAgentDir();
const legacyPath = () => resolve(agentDir(), "extensions/process.json");
const currentPath = () => resolve(agentDir(), "extensions/processes.json");

function writeFile(path: string, contents: string): void {
  vol.mkdirSync(resolve(path, ".."), { recursive: true });
  vol.writeFileSync(path, contents);
}

function read(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  return String(vol.readFileSync(path, "utf-8"));
}

describe("000 import legacy process config", () => {
  beforeEach(() => {
    vol.reset();
  });

  it("copies process.json to processes.json when only the legacy file exists", async () => {
    writeFile(
      legacyPath(),
      JSON.stringify({ interception: { blockBackgroundCommands: true } }),
    );

    const result = await importLegacyProcessConfig();

    expect(result).toEqual({ kind: "imported", legacyPath: legacyPath() });
    expect(read(currentPath())).toBe(
      JSON.stringify({ interception: { blockBackgroundCommands: true } }),
    );
    expect(read(legacyPath())).toBe(
      JSON.stringify({ interception: { blockBackgroundCommands: true } }),
    );
  });

  it("does nothing when processes.json already exists", async () => {
    writeFile(
      legacyPath(),
      JSON.stringify({ follow: { enabledByDefault: false } }),
    );
    writeFile(
      currentPath(),
      JSON.stringify({ widget: { dockDefaultState: "collapsed" } }),
    );

    const result = await importLegacyProcessConfig();

    expect(result).toEqual({ kind: "skipped" });
    expect(read(currentPath())).toBe(
      JSON.stringify({ widget: { dockDefaultState: "collapsed" } }),
    );
    expect(read(legacyPath())).toBe(
      JSON.stringify({ follow: { enabledByDefault: false } }),
    );
  });

  it("does nothing when neither file exists", async () => {
    const result = await importLegacyProcessConfig();
    expect(result).toEqual({ kind: "skipped" });
    expect(existsSync(currentPath())).toBe(false);
    expect(existsSync(legacyPath())).toBe(false);
  });

  it("does nothing when only processes.json exists", async () => {
    writeFile(currentPath(), JSON.stringify({}));

    const result = await importLegacyProcessConfig();

    expect(result).toEqual({ kind: "skipped" });
    expect(read(legacyPath())).toBeUndefined();
  });

  it("returns invalid and does not copy when process.json is malformed JSON", async () => {
    writeFile(legacyPath(), "{ this is not json");

    const result = await importLegacyProcessConfig();

    expect(result).toMatchObject({
      kind: "invalid",
      legacyPath: legacyPath(),
    });
    expect(existsSync(currentPath())).toBe(false);
    // Legacy file left untouched for manual recovery.
    expect(read(legacyPath())).toBe("{ this is not json");
  });

  it("returns invalid when process.json is valid JSON but not an object", async () => {
    writeFile(legacyPath(), JSON.stringify(["not", "an", "object"]));

    const result = await importLegacyProcessConfig();

    expect(result).toMatchObject({
      kind: "invalid",
      legacyPath: legacyPath(),
    });
    expect(existsSync(currentPath())).toBe(false);
  });
});
