import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

import {
  MAX_LOG_MATCH_PATTERN_LENGTH,
  MAX_LOG_MATCHERS_PER_PROCESS,
} from "../../../src/manager/log-matchers";
import { LINE_MATCH_MODES } from "../../../src/utils/match-line";
import { LOG_MATCH_STREAMS } from "../../../src/wake";
import { PROCESS_PROTOCOL_ATTENTIONS } from "../../shared/protocol";

export const LogMatcherConfigSchema = Type.Object({
  pattern: Type.String({
    maxLength: MAX_LOG_MATCH_PATTERN_LENGTH,
    description:
      "Log pattern to match. Limited to 500 characters. Literal by default; regex only when mode is regex.",
  }),
  mode: Type.Optional(
    StringEnum(LINE_MATCH_MODES, {
      description: "Pattern matching mode. Defaults to literal.",
    }),
  ),
  stream: Type.Optional(
    StringEnum(LOG_MATCH_STREAMS, {
      description: "Output stream to inspect. Defaults to both.",
    }),
  ),
  repeat: Type.Optional(
    Type.Boolean({
      description:
        "Whether this matcher can notify more than once. Defaults to false.",
    }),
  ),
  on: Type.Optional(
    StringEnum(PROCESS_PROTOCOL_ATTENTIONS, {
      description: "Agent attention for this log match. Defaults to turn.",
    }),
  ),
});

export const NotifyConfigSchema = Type.Object({
  onSuccess: Type.Optional(
    StringEnum(PROCESS_PROTOCOL_ATTENTIONS, {
      description: "Attention on clean exit. Defaults to turn.",
    }),
  ),
  onFailure: Type.Optional(
    StringEnum(PROCESS_PROTOCOL_ATTENTIONS, {
      description: "Attention on failure or crash. Defaults to turn.",
    }),
  ),
  onKilled: Type.Optional(
    StringEnum(PROCESS_PROTOCOL_ATTENTIONS, {
      description: "Attention on external kill. Defaults to context.",
    }),
  ),
  logMatches: Type.Optional(
    Type.Array(LogMatcherConfigSchema, {
      maxItems: MAX_LOG_MATCHERS_PER_PROCESS,
      description:
        "Log match notifications. Supports at most 20 matchers, with each pattern limited to 500 characters.",
    }),
  ),
});
