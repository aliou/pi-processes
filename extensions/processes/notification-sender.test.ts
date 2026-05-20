import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import { MESSAGE_TYPE_PROCESS_NOTIFICATION } from "./constants";
import { sendProcessNotificationMessage } from "./notification-sender";
import type { ProcessNotificationDetails } from "./notifications/types";

const details: ProcessNotificationDetails = {
  kind: "crash",
  processId: "proc_1",
  processName: "test",
  command: "pnpm test",
  timestamp: 123,
  summary: "Process failed.",
  status: "exited",
  exitCode: 1,
  endReason: "exit",
  signal: null,
  attention: "turn",
};

const options = {
  triggerTurn: true,
  deliverAs: "steer" as const,
};

function piWithSendMessage(
  sendMessage: ExtensionAPI["sendMessage"],
): ExtensionAPI {
  return { sendMessage } as ExtensionAPI;
}

describe("sendProcessNotificationMessage", () => {
  it("sends a displayed process notification custom message", () => {
    const sendMessage = vi.fn();

    sendProcessNotificationMessage(
      piWithSendMessage(sendMessage),
      details,
      options,
    );

    expect(sendMessage).toHaveBeenCalledWith(
      {
        customType: MESSAGE_TYPE_PROCESS_NOTIFICATION,
        content: expect.stringContaining(
          '<process_event type="lifecycle" kind="crash" process_id="proc_1" process_name="test" status="exited">',
        ),
        display: true,
        details,
      },
      options,
    );
  });

  it("does not catch sendMessage errors", () => {
    const error = new Error("send failed");
    const sendMessage = vi.fn(() => {
      throw error;
    });

    expect(() =>
      sendProcessNotificationMessage(
        piWithSendMessage(sendMessage),
        details,
        options,
      ),
    ).toThrow(error);
  });
});
