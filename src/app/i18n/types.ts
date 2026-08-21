export type AppLocale = 'zh-TW' | 'zh-CN' | 'en' | 'ja';

export type I18nParams = Record<string, string | number>;

/** Flat key → message. Use {{name}} placeholders. */
export type I18nDictionary = Record<string, string>;

/** Endonym + English so the picker is readable before the UI language is switched. */
export const APP_LOCALES: { id: AppLocale; nativeLabel: string }[] = [
  { id: 'zh-TW', nativeLabel: '繁體中文 Traditional' },
  { id: 'zh-CN', nativeLabel: '简体中文 Simplified' },
  { id: 'en', nativeLabel: 'English' },
  { id: 'ja', nativeLabel: '日本語 Japanese' },
];

export const DEFAULT_LOCALE: AppLocale = 'zh-TW';
