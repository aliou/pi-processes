import type { ProcessManager } from "../../../../src/manager";
import type { ProcessInfo } from "../../../../src/types";
import type { ProcessesParamsType } from "../schema";

export interface WriteDetails {
  action: "write";
  id: string;
  processName: string;
  process: ProcessInfo | null;
  bytes: number;
  end: boolean;
  ok: boolean;
  reason: string | null;
}

/**
 * Write text to a running process's stdin.
 *
 * `input` defaults to an empty string so a caller can close stdin with
 * `{ action: "write", id, end: true }` to signal EOF without writing anything.
 */
export function executeWrite(
  params: ProcessesParamsType,
  manager: ProcessManager,
): WriteDetails {
  if (!params.id) {
    throw new Error("process write requires id");
  }

  const id = params.id;
  const input = params.input ?? "";
  const end = params.end ?? false;

  if (input.length === 0 && !end) {
    throw new Error(
      'process write requires "input" or "end"; provide text to write or set end to close stdin',
    );
  }

  const process = manager.get(id);
  const result = manager.writeToStdin(id, input, { end });

  if (result.ok) {
    return {
      action: "write",
      id,
      processName: process?.name ?? "(unknown)",
      process,
      bytes: Buffer.byteLength(input, "utf-8"),
      end,
      ok: true,
      reason: null,
    };
  }

  return {
    action: "write",
    id,
    processName: process?.name ?? "(unknown)",
    process,
    bytes: 0,
    end,
    ok: false,
    reason: result.reason,
  };
}

export function formatWriteDetails(details: WriteDetails): string {
  if (!details.ok) {
    return `Failed to write to stdin for "${details.processName}" (${details.id}): ${details.reason}.`;
  }

  const suffix = details.end ? " and closed stdin" : "";
  return `Wrote ${details.bytes} byte${details.bytes === 1 ? "" : "s"} to "${details.processName}" (${details.id})${suffix}.`;
}
