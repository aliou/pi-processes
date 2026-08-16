// Re-export the protocol-safe notification types so the core extension and the
// protocol layer cannot drift apart. The canonical shape lives in
// `extensions/shared/protocol/notifications.ts`; these names keep existing import sites
// stable while guaranteeing structural compatibility with the events emitted on
// CHANNELS.NOTIFICATION.
export type {
  ProcessProtocolAttention as Attention,
  ProcessProtocolNotificationKind as ProcessNotificationKind,
  ProcessProtocolNotificationLogMatch as ProcessNotificationLogMatchDetails,
  ProcessProtocolNotificationPayload as ProcessNotificationDetails,
} from "../../shared/protocol";
