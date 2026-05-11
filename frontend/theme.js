const THEME_STORAGE_KEY = "matter-workbench-theme";
const DEFAULT_THEME = "light";
const VALID_THEMES = new Set(["dark", "light"]);

export function normalizeTheme(value) {
  return VALID_THEMES.has(value) ? value : DEFAULT_THEME;
}

export function nextTheme(value) {
  return normalizeTheme(value) === "light" ? "dark" : "light";
}

export function createThemeController({
  button,
  root = globalThis.document?.documentElement,
  storage = globalThis.localStorage,
} = {}) {
  let currentTheme = DEFAULT_THEME;

  function readStoredTheme() {
    try {
      return normalizeTheme(storage?.getItem(THEME_STORAGE_KEY));
    } catch {
      return DEFAULT_THEME;
    }
  }

  function storeTheme(theme) {
    try {
      storage?.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Browsers can block storage in private contexts; the in-page toggle still works.
    }
  }

  function updateButton(theme) {
    if (!button) return;
    const isLight = theme === "light";
    button.textContent = isLight ? "Dark" : "Light";
    button.title = isLight ? "Switch to dark theme" : "Switch to light theme";
    button.setAttribute("aria-label", button.title);
    button.setAttribute("aria-pressed", String(isLight));
  }

  function applyTheme(theme, { persist = false } = {}) {
    currentTheme = normalizeTheme(theme);
    if (root) root.dataset.theme = currentTheme;
    updateButton(currentTheme);
    if (persist) storeTheme(currentTheme);
    return currentTheme;
  }

  function toggleTheme() {
    return applyTheme(nextTheme(currentTheme), { persist: true });
  }

  function wire() {
    applyTheme(readStoredTheme());
    button?.addEventListener("click", toggleTheme);
    return currentTheme;
  }

  return {
    applyTheme,
    getTheme: () => currentTheme,
    toggleTheme,
    wire,
  };
}
