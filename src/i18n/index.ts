/**
 * i18n bootstrap (i18next + react-i18next).
 *
 * Two resource bundles (zh, en), default zh, fallback zh. Importing this module
 * initializes i18next as a side effect (kept for backwards compatibility), but
 * prefer calling the exported `initI18n()` explicitly from app bootstrap.
 *
 * Owned by the I18N agent. Other agents should consume keys via `@/i18n/keys`
 * (the `K` map) and translate with `react-i18next`'s `useTranslation()` or the
 * exported `t`.
 */

import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import { zh } from "./locales/zh";
import { en } from "./locales/en";
import type { ZhResources } from "./locales/zh";

export { K } from "./keys";
export type { TranslationKey, Namespace } from "./keys";
export { zh } from "./locales/zh";
export { en } from "./locales/en";

/** Supported UI languages. */
export const SUPPORTED_LANGUAGES = ["zh", "en"] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

/** Default language: matches the original Chinese app. */
export const DEFAULT_LANGUAGE: Language = "zh";

/** localStorage key used to persist the user's language choice. */
export const LANGUAGE_STORAGE_KEY = "walkplay-eq.lang";

/** Single `translation` namespace; resources are nested objects, not flat. */
export const resources = {
  zh: { translation: zh },
  en: { translation: en },
} as const;

/**
 * Resolve the initial language: persisted choice -> browser locale -> default.
 * Safe to call outside the browser (returns the default).
 */
export function detectInitialLanguage(): Language {
  try {
    const stored = globalThis.localStorage?.getItem(LANGUAGE_STORAGE_KEY);
    if (stored && (SUPPORTED_LANGUAGES as readonly string[]).includes(stored)) {
      return stored as Language;
    }
    const nav =
      typeof navigator !== "undefined" ? navigator.language?.toLowerCase() : undefined;
    if (nav?.startsWith("zh")) return "zh";
    if (nav?.startsWith("en")) return "en";
  } catch {
    // localStorage / navigator unavailable -> fall through to default.
  }
  return DEFAULT_LANGUAGE;
}

/**
 * Initialize i18next once. Idempotent: returns the existing instance if already
 * initialized. Call from app bootstrap (e.g. main.tsx) and await if you need a
 * guaranteed-ready instance before first render.
 */
export function initI18n(lng: Language = detectInitialLanguage()): typeof i18n {
  if (i18n.isInitialized) return i18n;

  void i18n.use(initReactI18next).init({
    resources,
    lng,
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: SUPPORTED_LANGUAGES as unknown as string[],
    defaultNS: "translation",
    interpolation: { escapeValue: false },
    returnNull: false,
  });

  return i18n;
}

/**
 * Change the active language and persist the choice.
 */
export async function setLanguage(lng: Language): Promise<void> {
  await i18n.changeLanguage(lng);
  try {
    globalThis.localStorage?.setItem(LANGUAGE_STORAGE_KEY, lng);
  } catch {
    // Ignore persistence failures (e.g. private mode).
  }
}

/** Current active language (falls back to default before init completes). */
export function getLanguage(): Language {
  const current = i18n.language as Language | undefined;
  return current && (SUPPORTED_LANGUAGES as readonly string[]).includes(current)
    ? current
    : DEFAULT_LANGUAGE;
}

// Initialize on import so `import "@/i18n"` keeps working for early consumers.
initI18n();

/** Standalone `t` for use outside React components (tray menus, stores, etc.). */
export const t = i18n.t.bind(i18n);

export default i18n;

/**
 * Type augmentation: make `t()` and `useTranslation()` aware of our resource
 * shape so keys are validated at compile time and return types are correct.
 */
declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: {
      translation: ZhResources;
    };
  }
}
