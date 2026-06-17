import { fs, vol } from "memfs";
import { beforeEach, vi } from "vitest";

vi.mock("node:fs", () => ({ ...fs }));
vi.mock("node:fs/promises", () => ({ ...fs.promises }));

beforeEach(() => {
  vol.reset();
});
