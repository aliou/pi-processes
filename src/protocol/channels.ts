export const CHANNELS = {
  // Core broadcasts
  STARTED: "processes:started",
  ENDED: "processes:ended",
  OUTPUT_CHANGED: "processes:output_changed",
  CHANGED: "processes:changed",

  // Request channels (UI -> core, sync callback)
  REQUEST_LIST: "processes:request:list",
  REQUEST_GET: "processes:request:get",
  REQUEST_OUTPUT: "processes:request:output",
  REQUEST_COMBINED_OUTPUT: "processes:request:combined_output",
  REQUEST_LOG_FILES: "processes:request:log_files",
  REQUEST_FILE_SIZE: "processes:request:file_size",
  REQUEST_CONFIG: "processes:request:config",

  // Command channels (UI -> core, callback)
  COMMAND_KILL: "processes:command:kill",
  COMMAND_CLEAR: "processes:command:clear",
  // Other extensions emit this to hand an already-running child process
  // over to the manager (e.g. backgrounding a foreground tool command).
  COMMAND_ADOPT: "processes:command:adopt",
  // Pin handled by the dock extension, if loaded.
  COMMAND_PIN: "processes:command:pin",

  // Log subscription channels
  LOGS_SUBSCRIBE: "processes:logs:subscribe",
  LOGS_UNSUBSCRIBE: "processes:logs:unsubscribe",
  LOGS_CHUNK: "processes:logs:chunk",

  // Notification fanout (core emits, UI + core delivery listen)
  NOTIFICATION: "processes:notification",
} as const;
