import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { defaultLanguage, resources } from './resources';

void i18n.use(initReactI18next).init({
  fallbackLng: defaultLanguage,
  interpolation: { escapeValue: false },
  lng: defaultLanguage,
  resources,
});

export { i18n };
