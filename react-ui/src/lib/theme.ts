export type AppTheme = 'light' | 'dark';

type ThemeStorage = Pick<Storage, 'getItem'>;

export function normalizeTheme(value: unknown): AppTheme {
  return value === 'dark' ? 'dark' : 'light';
}

export function nextTheme(theme: unknown): AppTheme {
  return normalizeTheme(theme) === 'dark' ? 'light' : 'dark';
}

export function readStoredTheme(storage: ThemeStorage | null = browserThemeStorage()): AppTheme {
  try {
    return normalizeTheme(storage?.getItem('matter-workbench-theme'));
  } catch {
    return 'light';
  }
}

function browserThemeStorage(): ThemeStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
