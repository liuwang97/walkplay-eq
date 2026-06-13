/**
 * i18n bootstrap (i18next + react-i18next).
 *
 * STUB: the I18N agent adds real resource bundles (zh/en) and language
 * detection. Importing this module initializes i18next as a side effect.
 */

import i18n from "i18next";
import { initReactI18next } from "react-i18next";

const resources = {
  en: {
    translation: {
      appName: "Walkplay EQ",
    },
  },
  zh: {
    translation: {
      appName: "Walkplay EQ",
    },
  },
} as const;

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources,
    lng: "en",
    fallbackLng: "en",
    interpolation: { escapeValue: false },
  });
}

export default i18n;
