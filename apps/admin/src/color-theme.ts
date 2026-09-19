export const colorThemes = [
  {
    id: "emerald",
    label: "Emerald",
    swatches: ["#047857", "#10b981", "#a7f3d0"],
  },
  {
    id: "blue",
    label: "Blue",
    swatches: ["#1e40af", "#3b82f6", "#bfdbfe"],
  },
  {
    id: "indigo",
    label: "Indigo",
    swatches: ["#3730a3", "#6366f1", "#c7d2fe"],
  },
  {
    id: "violet",
    label: "Violet",
    swatches: ["#5b21b6", "#8b5cf6", "#ddd6fe"],
  },
  {
    id: "rose",
    label: "Rose",
    swatches: ["#be123c", "#fb7185", "#fecdd3"],
  },
  {
    id: "teal",
    label: "Teal",
    swatches: ["#0f766e", "#14b8a6", "#99f6e4"],
  },
  {
    id: "sky",
    label: "Sky",
    swatches: ["#0369a1", "#0ea5e9", "#bae6fd"],
  },
  {
    id: "orange",
    label: "Orange",
    swatches: ["#c2410c", "#f97316", "#fed7aa"],
  },
  {
    id: "amber",
    label: "Amber",
    swatches: ["#b45309", "#f59e0b", "#fde68a"],
  },
  {
    id: "neutral",
    label: "Neutral",
    swatches: ["#1f2937", "#6b7280", "#d1d5db"],
  },
  {
    id: "stone",
    label: "Stone",
    swatches: ["#44403c", "#a8a29e", "#e7e5e4"],
  },
  {
    id: "zinc",
    label: "Zinc",
    swatches: ["#27272a", "#71717a", "#d4d4d8"],
  },
  {
    id: "mauve",
    label: "Mauve",
    swatches: ["#70495c", "#a77b8d", "#ead6dd"],
  },
  {
    id: "olive",
    label: "Olive",
    swatches: ["#4e5c3a", "#7f9562", "#dce5c8"],
  },
  {
    id: "mist",
    label: "Mist",
    swatches: ["#3b5c6e", "#6b91a4", "#d7e7ee"],
  },
  {
    id: "taupe",
    label: "Taupe",
    swatches: ["#634f3b", "#a48665", "#e8dac9"],
  },
] as const;

export type ColorTheme = (typeof colorThemes)[number]["id"];

export function isColorTheme(value: unknown): value is ColorTheme {
  return (
    typeof value === "string" &&
    colorThemes.some((option) => option.id === value)
  );
}

export function colorThemeLabel(theme: ColorTheme): string {
  return colorThemes.find((option) => option.id === theme)?.label ?? theme;
}

export function colorThemeSwatches(theme: ColorTheme) {
  return (
    colorThemes.find((option) => option.id === theme)?.swatches ??
    colorThemes[0].swatches
  );
}
