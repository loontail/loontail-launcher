import i18n from 'i18next';
import { initReactI18next, type useTranslation } from 'react-i18next';

export type Translator = ReturnType<typeof useTranslation>['t'];
import en from './locales/en.json';
import uk from './locales/uk.json';

const LANGUAGE_STORAGE_KEY = 'language';

export const SUPPORTED_LANGUAGES = ['en', 'uk'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

const isLanguage = (value: string | null): value is Language =>
  value !== null && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);

const readStoredLanguage = (): Language => {
  const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
  return isLanguage(stored) ? stored : 'en';
};

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    uk: { translation: uk },
  },
  lng: readStoredLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export const changeLanguage = (language: Language): void => {
  localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  void i18n.changeLanguage(language);
};

export const getCurrentLanguage = (): Language => {
  const current = i18n.language;
  return isLanguage(current) ? current : 'en';
};

export { i18n };
