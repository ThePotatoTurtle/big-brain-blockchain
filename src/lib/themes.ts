export interface ThemeOption {
  id: string;
  name: string;
  swatch: string; // accent color, used as the preview dot in the picker
}

/** Keep in sync with the `:root[data-theme="..."]` blocks in globals.css. */
export const THEMES: ThemeOption[] = [
  { id: "midnight", name: "Midnight", swatch: "#3B82F6" },
  { id: "plum", name: "Plum", swatch: "#A855F7" },
  { id: "forest", name: "Forest", swatch: "#2DD4BF" },
  { id: "rose", name: "Rose", swatch: "#EC4899" },
  { id: "steel", name: "Steel", swatch: "#06B6D4" },
  { id: "indigo", name: "Indigo", swatch: "#6366F1" },
  { id: "gold", name: "Gold", swatch: "#F59E0B" },
  { id: "ember", name: "Ember", swatch: "#F97316" },
  { id: "graphite", name: "Graphite", swatch: "#64748B" },
];

export const THEME_STORAGE_KEY = "bbb-theme";
export const THEME_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
