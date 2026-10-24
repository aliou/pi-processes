import type * as nodeFs from "node:fs";
import { existsSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  defaultKnownShellPaths,
  resolveShellExecutable,
} from "./command-executor";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof nodeFs>();
  return { ...actual, existsSync: vi.fn() };
});

const existsSyncMock = vi.mocked(existsSync);

describe("resolveShellExecutable", () => {
  it("prefers shell configured in settings when it is an existing absolute path", () => {
    existsSyncMock.mockImplementation(
      (path) => path === "/nix/store/abc-bash-5.3/bin/bash",
    );

    const resolved = resolveShellExecutable({
      configuredShell: "/nix/store/abc-bash-5.3/bin/bash",
      knownPaths: ["/bin/bash", "/usr/bin/bash"],
    });

    expect(resolved).toBe("/nix/store/abc-bash-5.3/bin/bash");
  });

  it("falls back to first existing known shell path", () => {
    existsSyncMock.mockImplementation((path) => path === "/usr/bin/bash");

    const resolved = resolveShellExecutable({
      configuredShell: undefined,
      knownPaths: ["/bin/bash", "/usr/bin/bash", "/usr/local/bin/bash"],
    });

    expect(resolved).toBe("/usr/bin/bash");
  });

  it("throws when no configured/known shell path exists", () => {
    existsSyncMock.mockReturnValue(false);

    expect(() =>
      resolveShellExecutable({
        configuredShell: undefined,
        knownPaths: ["/bin/bash", "/usr/bin/bash"],
      }),
    ).toThrow(/shell/i);
  });
});

describe("defaultKnownShellPaths", () => {
  it("includes the Termux $PREFIX shell when PREFIX is set", () => {
    expect(
      defaultKnownShellPaths({
        PREFIX: "/data/data/com.termux/files/usr",
      }),
    ).toContain("/data/data/com.termux/files/usr/bin/bash");
  });

  it("includes the shell from $SHELL", () => {
    expect(
      defaultKnownShellPaths({ SHELL: "/opt/homebrew/bin/bash" }),
    ).toContain("/opt/homebrew/bin/bash");
  });

  it("keeps the static paths when no env hints are present", () => {
    expect(defaultKnownShellPaths({})).toEqual([
      "/run/current-system/sw/bin/bash",
      "/bin/bash",
      "/usr/bin/bash",
      "/usr/local/bin/bash",
    ]);
  });
});
