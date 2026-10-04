export type PluginIdeTheme = {
  background: string;
  foreground: string;
  muted: string;
  mutedForeground: string;
  border: string;
  primary: string;
  fontFamily: string;
  isDark: boolean;
};

const DEFAULT_THEME: PluginIdeTheme = {
  background: "#ffffff",
  foreground: "#1b2430",
  muted: "#f4f6f8",
  mutedForeground: "#526070",
  border: "#d8dee6",
  primary: "#167a59",
  fontFamily: "system-ui, sans-serif",
  isDark: false,
};

const THEME_COLOR_PROPERTIES = {
  background: "--background",
  foreground: "--foreground",
  muted: "--muted",
  mutedForeground: "--muted-foreground",
  border: "--border",
  primary: "--primary",
} as const;

function clamp(value: number) {
  return Math.min(1, Math.max(0, value));
}

function linearToSrgb(value: number) {
  const clamped = clamp(value);
  return clamped <= 0.0031308
    ? 12.92 * clamped
    : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
}

function oklchToHex(value: string): string | null {
  const match = value.match(
    /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)(%?)\s+([\d.]+)(?:deg)?(?:\s*\/\s*[\d.]+%?)?\s*\)$/i,
  );
  if (!match) return null;
  const lightness = Number(match[1]) / (match[2] ? 100 : 1);
  const chroma = Number(match[3]) / (match[4] ? 100 : 1);
  const hue = (Number(match[5]) * Math.PI) / 180;
  if (![lightness, chroma, hue].every(Number.isFinite)) return null;
  const a = chroma * Math.cos(hue);
  const b = chroma * Math.sin(hue);
  const l = Math.pow(lightness + 0.3963377774 * a + 0.2158037573 * b, 3);
  const m = Math.pow(lightness - 0.1055613458 * a - 0.0638541728 * b, 3);
  const s = Math.pow(lightness - 0.0894841775 * a - 1.291485548 * b, 3);
  const channels = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return `#${channels
    .map((channel) =>
      Math.round(linearToSrgb(channel) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

function srgbToHex(value: string): string | null {
  const match = value.match(
    /^color\(\s*srgb\s+([\d.]+)(%?)\s+([\d.]+)(%?)\s+([\d.]+)(%?)(?:\s*\/\s*[\d.]+%?)?\s*\)$/i,
  );
  if (!match) return null;
  const channels = [1, 3, 5].map((index) => {
    const channel = Number(match[index]) / (match[index + 1] ? 100 : 1);
    return Math.round(clamp(channel) * 255);
  });
  if (!channels.every(Number.isFinite)) return null;
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function parseColorAlpha(value: string): number {
  const alpha =
    value.match(/\/\s*([\d.]+)(%)?\s*\)$/) ??
    (/^rgba\(/i.test(value)
      ? value.match(/^rgba\(\s*[^,]+,\s*[^,]+,\s*[^,]+,\s*([\d.]+)(%)?\s*\)$/i)
      : null);
  if (!alpha) return 1;
  const isPercent = alpha[2] === "%";
  const parsed = Number(alpha[1]) / (isPercent ? 100 : 1);
  return Number.isFinite(parsed) ? clamp(parsed) : 1;
}

function blendHex(foreground: string, background: string, alpha: number) {
  if (alpha >= 1) return foreground;
  const front = foreground
    .slice(1)
    .match(/.{2}/g)!
    .map((channel) => parseInt(channel, 16));
  const back = background
    .slice(1)
    .match(/.{2}/g)!
    .map((channel) => parseInt(channel, 16));
  return `#${front
    .map((channel, index) =>
      Math.round(channel * alpha + back[index] * (1 - alpha))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

function normalizeColor(
  value: string,
  fallback: string,
  background = DEFAULT_THEME.background,
): string {
  const normalized = value.trim().toLowerCase();
  const hexMatch = normalized.match(/^#([\da-f]{3}|[\da-f]{6})$/i);
  let color: string | null = null;
  let alpha = parseColorAlpha(normalized);
  if (hexMatch) {
    const hex = hexMatch[1];
    color =
      hex.length === 3
        ? `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`
        : `#${hex}`;
  } else {
    const rgbMatch = normalized.match(
      /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*[\d.]+)?\s*\)$/,
    );
    if (rgbMatch) {
      const channels = rgbMatch.slice(1).map(Number);
      if (channels.every((channel) => channel <= 255))
        color = `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
    }
  }
  color ??= oklchToHex(normalized) ?? srgbToHex(normalized);
  if (!color && typeof document !== "undefined" && document.documentElement) {
    const probe = document.createElement("span");
    probe.style.color = value;
    if (probe.style.color) {
      document.documentElement.append(probe);
      const computed = window.getComputedStyle(probe).color;
      probe.remove();
      const resolvedRgb = computed.match(
        /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*[\d.]+)?\s*\)$/,
      );
      if (resolvedRgb) {
        color = `#${resolvedRgb
          .slice(1)
          .map((channel) => Number(channel).toString(16).padStart(2, "0"))
          .join("")}`;
        alpha = parseColorAlpha(computed);
      } else {
        const resolvedSrgb = srgbToHex(computed);
        if (resolvedSrgb) {
          color = resolvedSrgb;
          alpha = parseColorAlpha(computed);
        }
      }
    }
  }
  return color ? blendHex(color, background, alpha) : fallback;
}

function safeFontFamily(value: string) {
  const fontFamily = value.trim();
  return fontFamily.length <= 160 && /^[\w\s,'"-]+$/.test(fontFamily)
    ? fontFamily
    : DEFAULT_THEME.fontFamily;
}

export function sanitizePluginIdeTheme(value: unknown): PluginIdeTheme {
  const input =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const background = normalizeColor(
    typeof input.background === "string" ? input.background : "",
    DEFAULT_THEME.background,
  );
  const colors = Object.fromEntries(
    Object.entries(THEME_COLOR_PROPERTIES).map(([key]) => [
      key,
      normalizeColor(
        typeof input[key] === "string" ? input[key] : "",
        DEFAULT_THEME[key as keyof typeof THEME_COLOR_PROPERTIES],
        background,
      ),
    ]),
  ) as Pick<PluginIdeTheme, keyof typeof THEME_COLOR_PROPERTIES>;
  return {
    ...colors,
    fontFamily:
      typeof input.fontFamily === "string"
        ? safeFontFamily(input.fontFamily)
        : DEFAULT_THEME.fontFamily,
    isDark:
      typeof input.isDark === "boolean" ? input.isDark : DEFAULT_THEME.isDark,
  };
}

export function readPluginIdeTheme(element: Element | null): PluginIdeTheme {
  if (!element || typeof window === "undefined" || !window.getComputedStyle)
    return { ...DEFAULT_THEME };
  const computed = window.getComputedStyle(element);
  const rootComputed = window.getComputedStyle(
    element.ownerDocument.documentElement,
  );
  const readInherited = (property: string) => {
    for (
      let current: Element | null = element;
      current;
      current = current.parentElement
    ) {
      const value = window
        .getComputedStyle(current)
        .getPropertyValue(property)
        .trim();
      if (value) return value;
    }
    return rootComputed.getPropertyValue(property).trim();
  };
  const values = Object.fromEntries(
    Object.entries(THEME_COLOR_PROPERTIES).map(([key, property]) => [
      key,
      readInherited(property),
    ]),
  );
  const fallbackBackground = normalizeColor(
    computed.backgroundColor,
    DEFAULT_THEME.background,
  );
  const theme = sanitizePluginIdeTheme({
    ...values,
    fontFamily:
      readInherited("--font-sans") ||
      computed.fontFamily ||
      DEFAULT_THEME.fontFamily,
    isDark: undefined,
  });
  const background = normalizeColor(
    values.background || "",
    fallbackBackground,
  );
  const [red, green, blue] = background
    .slice(1)
    .match(/.{2}/g)!
    .map((channel) => parseInt(channel, 16) / 255);
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  return { ...theme, background, isDark: luminance < 0.45 };
}

export function observePluginIdeTheme(
  element: Element,
  callback: (theme: PluginIdeTheme) => void,
): () => void {
  const ancestors: Element[] = [];
  for (
    let current: Element | null = element;
    current;
    current = current.parentElement
  )
    ancestors.push(current);
  const observer = new MutationObserver(() =>
    callback(readPluginIdeTheme(element)),
  );
  for (const ancestor of ancestors)
    observer.observe(ancestor, {
      attributes: true,
      attributeFilter: ["class", "style", "data-color-theme"],
    });
  const media = window.matchMedia?.("(prefers-color-scheme: dark)");
  const onMediaChange = () => callback(readPluginIdeTheme(element));
  if (media?.addEventListener) media.addEventListener("change", onMediaChange);
  else media?.addListener?.(onMediaChange);
  callback(readPluginIdeTheme(element));
  return () => {
    observer.disconnect();
    if (media?.removeEventListener)
      media.removeEventListener("change", onMediaChange);
    else media?.removeListener?.(onMediaChange);
  };
}
