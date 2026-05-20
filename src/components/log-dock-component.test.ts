import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { renderCollapsedDockLine } from "./log-dock-component";

const CIRCLECI_LINE =
  "run-cm-be-tests - db5d24ee pending ↻ https://app.circleci.com/pipelines/gh/coursedog/coursedogv3/106313/workflows/f68e6db3-667d-48a0-ac75-d34be7c17e09?utm_campaign=vcs-integration-link&utm_medium=referral&utm_source=github-checks-link";

describe("renderCollapsedDockLine", () => {
  it("leaves a spare terminal column for long log lines", () => {
    for (const width of [1, 2, 40, 80, 120]) {
      const rendered = renderCollapsedDockLine(CIRCLECI_LINE, width);

      expect(visibleWidth(rendered)).toBe(width - 1);
    }
  });

  it("leaves a spare terminal column for ansi-styled log lines", () => {
    const rendered = renderCollapsedDockLine(
      `\u001b[2m${CIRCLECI_LINE}\u001b[22m`,
      80,
    );

    expect(visibleWidth(rendered)).toBe(79);
  });

  it("renders nothing for zero width", () => {
    expect(renderCollapsedDockLine(CIRCLECI_LINE, 0)).toBe("");
  });
});
