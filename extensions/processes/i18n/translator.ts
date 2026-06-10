import type { MessageKey } from "./messages";
import { ENGLISH } from "./messages";

export type { MessageKey } from "./messages";

export type Translator = (
  key: MessageKey,
  params?: Record<string, unknown>,
) => string;

function pluralize(count: number): string {
  return count === 1 ? "" : "es";
}

function formatTemplate(
  template: string,
  params: Record<string, unknown>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    if (key === "count_plural") {
      const count = Number(params.count) || 0;
      return pluralize(count);
    }
    return String(params[key] ?? match);
  });
}

/**
 * Create a translator with optional overrides.
 *
 * Overrides map message keys to custom strings. Unoverridden keys
 * fall back to English defaults.
 */
export function createTranslator(
  overrides?: Partial<Record<MessageKey, string>>,
): Translator {
  const strings = { ...ENGLISH, ...overrides };

  return (key, params) => {
    const template = strings[key] ?? ENGLISH[key] ?? key;
    if (!params) return template;
    return formatTemplate(template, params);
  };
}

/**
 * Default translator with English fallbacks. No overrides.
 */
export const t: Translator = createTranslator();
