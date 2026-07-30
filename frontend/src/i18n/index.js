import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en.json';
import sw from './sw.json';

/**
 * Per-locale text-direction configuration.
 * Add new locales here as they are introduced.
 * RTL locales (Arabic, Hebrew, etc.) should be listed with 'rtl'.
 *
 * Follow-up: Add 'ar' (Arabic) and 'he' (Hebrew) entries once those
 * locale translation files land (tracked in issue #1061).
 */
export const LOCALE_DIRECTIONS = {
  en: 'ltr',
  sw: 'ltr',
  // ar: 'rtl',  // uncomment when Arabic locale is added
  // he: 'rtl',  // uncomment when Hebrew locale is added
};

/** Returns the text direction for the given locale code, defaulting to 'ltr'. */
export function getLocaleDirection(lng) {
  return LOCALE_DIRECTIONS[lng] ?? 'ltr';
}

i18n
  .use(initReactI18next)
  .init({
    resources: { en: { translation: en }, sw: { translation: sw } },
    lng: localStorage.getItem('lang') || 'en',
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
  });

i18n.on('languageChanged', (lng) => {
  localStorage.setItem('lang', lng);
  // Apply dir attribute to document root whenever the language changes
  const dir = getLocaleDirection(lng);
  document.documentElement.setAttribute('dir', dir);
  document.documentElement.setAttribute('lang', lng);
});

// Apply direction on initial load
const initialLng = localStorage.getItem('lang') || 'en';
document.documentElement.setAttribute('dir', getLocaleDirection(initialLng));
document.documentElement.setAttribute('lang', initialLng);

export default i18n;
