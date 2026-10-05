import type { Copy } from '../i18n';

// The app's selectable looks. A theme is a set of CSS token overrides in
// src/styles/themes/<id>.css plus optional art in ./art.tsx; see docs/design-system.md.
export const themes = ['classic', 'space'] as const;
export type ThemeId = typeof themes[number];

type ThemeMeta = {
  /** Dictionary key of the theme's name, in both en.ts and nl.ts. */
  name: keyof Copy;
  /** Google Fonts stylesheet loaded only while the theme is active. */
  fonts?: string;
};

export const themeMeta: Record<ThemeId, ThemeMeta> = {
  classic: { name: 'themeClassic' },
  space: { name: 'themeSpace', fonts: 'https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@500;600;700&display=swap' },
};

const storageKey = 'home-theme';
const isTheme = (value: unknown): value is ThemeId => themes.includes(value as ThemeId);

export function initialTheme(): ThemeId {
  try {
    const stored = localStorage.getItem(storageKey);
    if (isTheme(stored)) return stored;
  } catch { /* Browser storage can be unavailable; theme switching still works. */ }
  return 'classic';
}

export function storeTheme(theme: ThemeId) {
  try { localStorage.setItem(storageKey, theme); } catch { /* Optional preference storage. */ }
}

/** Points <html> at the theme's tokens, loads its fonts and matches the browser toolbar to the page. */
export function applyTheme(theme: ThemeId) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  const fonts = themeMeta[theme].fonts;
  if (fonts && !document.querySelector(`link[data-theme-fonts="${theme}"]`)) {
    const link = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: fonts });
    link.dataset.themeFonts = theme;
    document.head.append(link);
  }
  const page = getComputedStyle(root).getPropertyValue('--color-page').trim();
  if (page) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', page);
}
