import { StringEnum } from "@earendil-works/pi-ai";
import { type Static, Type } from "typebox";
import { PROCESS_STATUSES } from "../src/types";

const Attention = StringEnum(["turn", "context", "ignore"] as const);
const WatchFields = {
  pattern: Type.String({ minLength: 1, maxLength: 500 }),
  mode: Type.Optional(StringEnum(["literal", "regex"] as const)),
  stream: Type.Optional(StringEnum(["stdout", "stderr", "both"] as const)),
  repeat: Type.Optional(Type.Boolean()),
  on: Type.Optional(Attention),
};
export const LogWatch = Type.Object(WatchFields);
export type LogWatch = Static<typeof LogWatch>;
export const NotifyConfig = Type.Object({
  onSuccess: Type.Optional(Attention),
  onFailure: Type.Optional(Attention),
  onKilled: Type.Optional(Attention),
  logMatches: Type.Optional(Type.Array(LogWatch, { maxItems: 20 })),
});
export type NotifyConfig = Static<typeof NotifyConfig>;

const WatchChange = Type.Object({
  mode: StringEnum(["append", "replace", "remove", "clear"] as const),
  items: Type.Optional(
    Type.Array(
      Type.Object({
        ...WatchFields,
        pattern: Type.Optional(WatchFields.pattern),
        index: Type.Optional(Type.Integer({ minimum: 0 })),
      }),
      { maxItems: 20 },
    ),
  ),
});
export type WatchChange = Static<typeof WatchChange>;

export const ProcessParams = Type.Object({
  action: StringEnum([
    "start",
    "list",
    "stop",
    "output",
    "write",
    "update",
    "clear",
  ] as const),
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
  command: Type.Optional(Type.String({ minLength: 1, maxLength: 64_000 })),
  cwd: Type.Optional(Type.String({ minLength: 1, maxLength: 4096 })),
  notify: Type.Optional(NotifyConfig),
  id: Type.Optional(Type.String({ minLength: 1 })),
  all: Type.Optional(Type.Boolean()),
  signal: Type.Optional(
    StringEnum(["SIGTERM", "SIGKILL", "SIGINT", "SIGHUP", "SIGQUIT"] as const),
  ),
  timeoutMs: Type.Optional(Type.Integer({ minimum: 0, maximum: 60_000 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  statuses: Type.Optional(
    Type.Array(
      StringEnum([...PROCESS_STATUSES, "all", "finished", "failed"] as const),
    ),
  ),
  sortBy: Type.Optional(
    StringEnum([
      "startTime_desc",
      "startTime_asc",
      "name_asc",
      "name_desc",
      "status_asc",
    ] as const),
  ),
  tailLines: Type.Optional(Type.Integer({ minimum: 1, maximum: 2000 })),
  stream: Type.Optional(StringEnum(["stdout", "stderr", "both"] as const)),
  pattern: Type.Optional(Type.String({ maxLength: 500 })),
  mode: Type.Optional(StringEnum(["literal", "regex"] as const)),
  input: Type.Optional(Type.String({ maxLength: 1_048_576 })),
  end: Type.Optional(Type.Boolean()),
  watches: Type.Optional(WatchChange),
});
export type ProcessParams = Static<typeof ProcessParams>;

export function required(value: string | undefined, field: string): string {
  if (!value) throw new Error(`process requires ${field}`);
  return value;
}
