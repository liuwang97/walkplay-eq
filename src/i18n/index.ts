/**
 * i18n (i18next + react-i18next): the shared zh / en strings, the `K` key map,
 * and the language helpers. Importing this module initializes i18next.
 *
 * Strings used by a single component live next to it in a small local table;
 * only strings shared across components belong here.
 */

import i18n from "i18next";
import { initReactI18next, useTranslation } from "react-i18next";

const zh = {
  connection: {
    connected: "已连接",
    disconnected: "未连接",
    connecting: "连接中",
    deviceInitFailed: "设备初始化失败",
  },
};

/** Every locale has exactly the keys of `zh`; a missing one is a compile error. */
type Resources = { [N in keyof typeof zh]: Record<keyof (typeof zh)[N], string> };

const en: Resources = {
  connection: {
    connected: "Connected",
    disconnected: "Disconnected",
    connecting: "Connecting",
    deviceInitFailed: "Device initialization failed",
  },
};

/** Dotted-path key constants, e.g. `K.connection.connected === "connection.connected"`. */
export const K = Object.fromEntries(
  Object.entries(zh).map(([ns, strings]) => [
    ns,
    Object.fromEntries(Object.keys(strings).map((key) => [key, `${ns}.${key}`])),
  ]),
) as { [N in keyof Resources]: { [P in keyof Resources[N] & string]: `${N}.${P}` } };

export type Language = "zh" | "en";

/** localStorage key used to persist the user's language choice. */
const LANGUAGE_STORAGE_KEY = "walkplay-eq.lang";

/** The persisted choice, else the system locale, else Chinese. */
function initialLanguage(): Language {
  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (stored === "zh" || stored === "en") return stored;
  } catch {
    /* storage unavailable — fall through */
  }
  return navigator.language?.toLowerCase().startsWith("en") ? "en" : "zh";
}

void i18n.use(initReactI18next).init({
  resources: { zh: { translation: zh }, en: { translation: en } },
  lng: initialLanguage(),
  fallbackLng: "zh",
  interpolation: { escapeValue: false },
});

/** The active language. */
export function getLanguage(): Language {
  return i18n.language?.startsWith("en") ? "en" : "zh";
}

/** Change the active language and persist the choice. */
export async function setLanguage(lng: Language): Promise<void> {
  await i18n.changeLanguage(lng);
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, lng);
  } catch {
    /* storage unavailable — non-fatal */
  }
}

/** The active language, re-rendering the component when it changes. */
export function useLang(): Language {
  useTranslation();
  return getLanguage();
}

export default i18n;

declare module "i18next" {
  interface CustomTypeOptions {
    resources: { translation: Resources };
  }
}
