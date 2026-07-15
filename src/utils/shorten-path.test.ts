import { describe, expect, it } from "vitest";

import { shortenPath } from "./shorten-path";

describe("shortenPath", () => {
  it("shortens the home directory and its descendants", () => {
    expect(shortenPath("/home/dev", "/home/dev")).toBe("~");
    expect(shortenPath("/home/dev/project", "/home/dev")).toBe("~/project");
  });

  it("does not shorten sibling paths sharing the home prefix", () => {
    expect(shortenPath("/home/developer/project", "/home/dev")).toBe(
      "/home/developer/project",
    );
  });
});
