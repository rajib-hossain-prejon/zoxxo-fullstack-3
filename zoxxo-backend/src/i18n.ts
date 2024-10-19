// src/i18n.ts
import i18next from 'i18next';
import middleware from 'i18next-http-middleware';

import enLocale from './locales/en/index.json';
import deLocale from './locales/de/index.json';

const languageDetector = new middleware.LanguageDetector(null, {
  order: ['cookie', 'header'],
  lookupCookie: 'zoxxo-language',
});

i18next.use(languageDetector).init({
  fallbackLng: 'en',
  preload: ['en', 'de'], // Add other languages as needed
  resources: {
    en: {
      common: enLocale,
    },
    de: {
      common: deLocale,
    },
  },
  keySeparator: false,
  ns: ['common'],
  defaultNS: 'common',
  debug: false,
});
i18next.on('languageChanged', (l) => console.log({ l }));

export default i18next;
