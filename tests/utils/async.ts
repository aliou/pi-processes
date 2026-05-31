export function flushQueuedMicrotasks(): Promise<void> {
  return new Promise((resolve) => queueMicrotask(resolve));
}
