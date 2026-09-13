import type { UiLanguagePreference } from './types.js';

export type UiLanguage = 'en' | 'zh-CN';

export function isSimplifiedChineseLocale(locale: string): boolean {
  const normalized = locale.trim().replaceAll('_', '-');
  if (normalized === '') return false;
  try {
    const parsed = new Intl.Locale(normalized);
    if (parsed.language.toLowerCase() !== 'zh') return false;
    const script = parsed.script?.toLowerCase();
    if (script === 'hant') return false;
    if (script === 'hans') return true;
    const region = parsed.region?.toUpperCase();
    if (region === 'TW' || region === 'HK' || region === 'MO') return false;
    if (region === 'CN' || region === 'SG') return true;
    return parsed.maximize().script?.toLowerCase() === 'hans';
  } catch {
    return false;
  }
}

export function resolveUiLanguage(
  preference: UiLanguagePreference,
  preferredSystemLanguages: readonly string[] = []
): UiLanguage {
  if (preference !== 'system') return preference;
  const firstLocale = preferredSystemLanguages.find((locale) => locale.trim() !== '');
  return firstLocale && isSimplifiedChineseLocale(firstLocale) ? 'zh-CN' : 'en';
}
