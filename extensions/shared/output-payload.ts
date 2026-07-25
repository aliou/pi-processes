import type { ProcessesOutputChangedPayload } from "../../src/protocol";
import { isRecord } from "../../src/utils/is-record";

export function isOutputChangedPayload(
  payload: unknown,
): payload is ProcessesOutputChangedPayload {
  return (
    isRecord(payload) &&
    typeof payload.id === "string" &&
    (payload.appendedText === undefined ||
      (Array.isArray(payload.appendedText) &&
        payload.appendedText.every(isOutputLine))) &&
    (payload.droppedLines === undefined ||
      (typeof payload.droppedLines === "number" &&
        Number.isSafeInteger(payload.droppedLines) &&
        payload.droppedLines > 0))
  );
}

function isOutputLine(
  value: unknown,
): value is { type: "stdout" | "stderr"; text: string } {
  return (
    isRecord(value) &&
    (value.type === "stdout" || value.type === "stderr") &&
    typeof value.text === "string"
  );
}
