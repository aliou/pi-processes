export interface LogsSubscribePayload {
  subscriberId: string;
  processId: string;
  tailLines?: number;
  reply: (
    result:
      | {
          ok: true;
          initialLines: Array<{ type: "stdout" | "stderr"; text: string }>;
        }
      | { ok: false; error: string },
  ) => void;
}

export interface LogsUnsubscribePayload {
  subscriberId: string;
}

export interface LogsChunkPayload {
  subscriberId: string;
  processId: string;
  lines: Array<{ type: "stdout" | "stderr"; text: string }>;
}
