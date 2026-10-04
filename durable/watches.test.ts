import { expect, it } from "vitest";
import { changeWatches, compileWatches, evaluateWatches } from "./watches";

const line = [{ type: "stdout" as const, text: "ready\n" }];

it("ignores text overwritten by carriage returns", () => {
  const watches = compileWatches([{ pattern: "hidden" }, { pattern: "ready" }]);
  const matches = evaluateWatches(
    watches,
    [{ type: "stdout", text: "hidden\rready\n" }],
    0,
  );
  expect(matches.map((match) => match.pattern)).toEqual(["ready"]);
});

it("keeps retained watch state, resets replacement state, and applies cooldowns", () => {
  const watches = compileWatches([{ pattern: "ready" }]);
  expect(evaluateWatches(watches, line, 0)).toHaveLength(1);
  const appended = changeWatches(watches, {
    mode: "append",
    items: [{ pattern: "ready", repeat: true }],
  });
  expect(evaluateWatches(appended, line, 1)).toHaveLength(1);
  expect(evaluateWatches(appended, line, 14_999)).toHaveLength(0);
  expect(evaluateWatches(appended, line, 15_001)).toHaveLength(1);
  const retained = changeWatches(appended, {
    mode: "remove",
    items: [{ index: 1 }],
  });
  expect(evaluateWatches(retained, line, 30_000)).toHaveLength(0);
  const replaced = changeWatches(retained, {
    mode: "replace",
    items: [{ pattern: "ready" }],
  });
  expect(evaluateWatches(replaced, line, 30_000)).toHaveLength(1);
  expect(changeWatches(replaced, { mode: "clear" })).toEqual([]);
});

it("validates regexes and watch limits before changing state", () => {
  const watches = compileWatches([
    { pattern: "ready", mode: "regex", stream: "stderr", on: "context" },
  ]);
  expect(evaluateWatches(watches, line, 0)).toEqual([]);
  const stderr = [{ type: "stderr" as const, text: "ready\n" }];
  expect(evaluateWatches(watches, stderr, 0)).toMatchObject([
    { attention: "context", stream: "stderr" },
  ]);
  expect(() =>
    changeWatches(watches, {
      mode: "append",
      items: [{ pattern: "[", mode: "regex" }],
    }),
  ).toThrow();
  expect(watches).toHaveLength(1);
  expect(() =>
    compileWatches(Array.from({ length: 21 }, () => ({ pattern: "ready" }))),
  ).toThrow("20");
  expect(() => changeWatches(watches, { mode: "remove", items: [{}] })).toThrow(
    "index or pattern",
  );
});
