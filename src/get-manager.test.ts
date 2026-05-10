import { describe, expect, it } from "vitest";
import { getManager } from "./get-manager";

describe("getManager", () => {
  it("creates a manager", () => {
    using manager = getManager();

    expect(manager).toBeDefined();
  });

  it("creates a fresh manager on each call", () => {
    using first = getManager();
    using second = getManager();

    expect(second).not.toBe(first);
  });

  it("passes configured shell callback to the manager", () => {
    const getConfiguredShellPath = () => "/bin/bash";
    using manager = getManager({ getConfiguredShellPath });

    expect(manager).toBeDefined();
  });
});
