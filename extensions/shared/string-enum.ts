import { type TUnsafe, Type } from "typebox";

/**
 * String enum schema compatible with providers that do not support anyOf/const
 * patterns: `{ type: "string", enum: [...] }`. Mirrors the helper pi's
 * extension loader provides for `@earendil-works/pi-ai` imports, which stopped
 * re-exporting a TypeBox-based one in pi 1.5.0.
 */
export function StringEnum<T extends readonly string[]>(
  values: T,
  options?: { description?: string; default?: T[number] },
): TUnsafe<T[number]> {
  return Type.Unsafe({
    type: "string",
    enum: values,
    ...(options?.description && { description: options.description }),
    ...(options?.default && { default: options.default }),
  });
}
