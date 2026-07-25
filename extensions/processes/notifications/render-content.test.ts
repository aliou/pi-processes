import { describe, expect, it } from "vitest";

import {
  buildProcessNotificationContent,
  escapeXmlAttribute,
  escapeXmlText,
} from "./render-content";
import type { ProcessNotificationDetails } from "./types";

describe("process notification content", () => {
  it("escapes XML text and attributes", () => {
    expect(escapeXmlText('a & b < c > d "quoted"')).toBe(
      'a &amp; b &lt; c &gt; d "quoted"',
    );
    expect(escapeXmlAttribute(`a & b < c > d "quoted" 'single'`)).toBe(
      "a &amp; b &lt; c &gt; d &quot;quoted&quot; &apos;single&apos;",
    );
  });

  it("builds lifecycle content with escaped envelope fields", () => {
    const details: ProcessNotificationDetails = {
      kind: "crash",
      processId: "proc_1&2",
      processName: 'test "unit"',
      command: "pnpm test -- --grep '<failure>'",
      timestamp: 123,
      summary: 'Process "test" failed because a < b & c > d.',
      status: "exited",
      exitCode: 1,
      endReason: "exit",
      signal: null,
      attention: "turn",
    };

    expect(buildProcessNotificationContent(details)).toBe(
      [
        '<process_event type="lifecycle" kind="crash" process_id="proc_1&amp;2" process_name="test &quot;unit&quot;" status="exited">',
        '  <summary>Process "test" failed because a &lt; b &amp; c &gt; d.</summary>',
        "  <command>pnpm test -- --grep '&lt;failure&gt;'</command>",
        "  <exit_code>1</exit_code>",
        "  <end_reason>exit</end_reason>",
        "  <logs_hint>Use process output/logs for process proc_1&amp;2 to inspect recent output.</logs_hint>",
        "</process_event>",
      ].join("\n"),
    );
  });

  it("builds log match content", () => {
    const details: ProcessNotificationDetails = {
      kind: "log_match",
      processId: "proc_1",
      processName: "dev",
      command: "pnpm dev",
      timestamp: 123,
      summary: 'Process "dev" matched log pattern "ready" on stdout.',
      logMatch: {
        pattern: "ready & listening",
        mode: "literal",
        stream: "stdout",
        line: "ready <http://localhost:3000>",
        matcherIndex: 0,
      },
      attention: "turn",
    };

    expect(buildProcessNotificationContent(details)).toContain(
      '<pattern mode="literal">ready &amp; listening</pattern>',
    );
    expect(buildProcessNotificationContent(details)).toContain(
      "<matched_line>ready &lt;http://localhost:3000&gt;</matched_line>",
    );
  });

  it("builds a summary-only suppression event", () => {
    const details: ProcessNotificationDetails = {
      kind: "log_match_suppressed",
      processId: "*",
      processName: "log watches",
      command: "",
      timestamp: 123,
      summary: "Suppressed 10 log-match notifications.",
      attention: "context",
    };

    expect(buildProcessNotificationContent(details)).toBe(
      [
        '<process_event type="notification_summary" kind="log_match_suppressed">',
        "  <summary>Suppressed 10 log-match notifications.</summary>",
        "</process_event>",
      ].join("\n"),
    );
  });
});
