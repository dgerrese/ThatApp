export type ThemePreference = "light" | "dark" | "auto";

// The inline script in web/index.html duplicates this key (and the accepted
// values) so it can apply a stored preference before the module graph loads.
// Change either without the other and the two fall out of agreement.
const STORAGE_KEY = "theme";

/**
 * "auto" for a value that is absent, unrecognised or unreadable. Storage that
 * throws must not become a hardcoded light or dark: an absent data-theme
 * attribute already means "follow the OS".
 */
export function themePreference(): ThemePreference {
  let stored: string | null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch {
    return "auto";
  }

  return stored === "light" || stored === "dark" ? stored : "auto";
}

export function setThemePreference(preference: ThemePreference): void {
  if (preference === "auto") {
    delete document.documentElement.dataset["theme"];
  } else {
    document.documentElement.dataset["theme"] = preference;
  }

  try {
    if (preference === "auto") {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, preference);
    }
  } catch {
    // The DOM already reflects the choice; all that is lost is persistence.
  }
}
