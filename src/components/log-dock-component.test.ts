import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { renderCollapsedDockLine } from "./log-dock-component";

const LONG_LOG_LINE =
  "build-step - 3f7a9c2 pending ↻ https://example.com/pipelines/project/service/123456/workflows/abcdef12-3456-7890-abcd-ef1234567890/jobs/integration-test?token=very-long-unbroken-log-segment-and-query-string";

describe("renderCollapsedDockLine", () => {
  it("leaves a spare terminal column for long log lines", () => {
    for (const width of [1, 2, 40, 80, 120]) {
      const rendered = renderCollapsedDockLine(LONG_LOG_LINE, width);

      expect(visibleWidth(rendered)).toBe(width - 1);
    }
  });

  it("leaves a spare terminal column for ansi-styled log lines", () => {
    const rendered = renderCollapsedDockLine(
      `\u001b[2m${LONG_LOG_LINE}\u001b[22m`,
      80,
    );

    expect(visibleWidth(rendered)).toBe(79);
  });

  it("renders nothing for zero width", () => {
    expect(renderCollapsedDockLine(LONG_LOG_LINE, 0)).toBe("");
  });
});
