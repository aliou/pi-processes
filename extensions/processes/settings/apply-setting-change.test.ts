import { describe, expect, it } from "vitest";
import type { ProcessConfig } from "../config";
import { applySettingChange } from "./apply-setting-change";

describe("applySettingChange", () => {
  const base: ProcessConfig = {};

  it("converts 'on'/'off' to boolean", () => {
    const on = applySettingChange(
      "interception.blockBackgroundCommands",
      "on",
      base,
    );
    expect(on?.interception?.blockBackgroundCommands).toBe(true);

    const off = applySettingChange(
      "interception.blockBackgroundCommands",
      "off",
      base,
    );
    expect(off?.interception?.blockBackgroundCommands).toBe(false);
  });

  it("returns null for non-core setting IDs", () => {
    expect(
      applySettingChange("follow.enabledByDefault", "off", base),
    ).toBeNull();
    expect(applySettingChange("output.maxOutputLines", "250", base)).toBeNull();
  });

  it("returns null for unknown setting IDs", () => {
    expect(applySettingChange("unknown.field", "value", base)).toBeNull();
  });
});
