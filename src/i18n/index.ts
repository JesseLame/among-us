import type { ErrorCode } from '../../shared/protocol';
import { en, enErrors, type Copy } from './en';
import { nl, nlErrors } from './nl';

export type Language = 'en' | 'nl';
export type { Copy };

export const translations: Record<Language, Copy> = { en, nl };
export const errorMessages: Record<Language, Record<ErrorCode, string>> = { en: enErrors, nl: nlErrors };

export function initialLanguage(): Language {
  try {
    const stored = localStorage.getItem('home-language');
    if (stored === 'en' || stored === 'nl') return stored;
  } catch { /* Browser storage can be unavailable; language switching still works. */ }
  return navigator.language.toLowerCase().startsWith('nl') ? 'nl' : 'en';
}
