export function flushQueuedMicrotasks(): Promise<void> {
  return new Promise((resolve) => queueMicrotask(resolve));
}

export function flushQueuedMacrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
