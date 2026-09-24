/** Public tenant identity. Authentication and private tenant metadata never belong here. */
export type TenantBranding = {
  displayName: string;
  loginTitle: string;
  loginDescription: string;
  primaryColor: string;
  accentColor: string;
  logoUrl: string | null;
  coverUrl: string | null;
  loginAnimationUrl: string | null;
  version: number;
};
export type TenantBrandingConfig = TenantBranding;
const assetPath =
  /^\/api\/public\/tenant-branding\/assets\/[1-9][0-9]*\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function defaultTenantBranding(name: string): TenantBranding {
  return {
    displayName: name.slice(0, 120),
    loginTitle: "Bienvenido a tu espacio",
    loginDescription:
      "Ingresa de forma segura para continuar trabajando con tu equipo.",
    primaryColor: "#0f766e",
    accentColor: "#134e4a",
    logoUrl: null,
    coverUrl: null,
    loginAnimationUrl: null,
    version: 0,
  };
}
export function parseTenantBranding(value: unknown): TenantBranding | null {
  try {
    const raw = typeof value === "string" ? JSON.parse(value) : value;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const fields = [
      "displayName",
      "loginTitle",
      "loginDescription",
      "primaryColor",
      "accentColor",
      "logoUrl",
      "coverUrl",
      "loginAnimationUrl",
      "version",
    ];
    if (Object.keys(raw).some((key) => !fields.includes(key))) return null;
    // Records saved before the login animation existed omit the field.
    const normalized =
      raw.loginAnimationUrl === undefined
        ? { ...raw, loginAnimationUrl: null }
        : raw;
    for (const [key, max] of [
      ["displayName", 120],
      ["loginTitle", 120],
      ["loginDescription", 600],
    ] as const) {
      if (
        typeof normalized[key] !== "string" ||
        normalized[key].length > max ||
        (key !== "loginDescription" && !normalized[key].trim())
      )
        return null;
    }
    for (const key of ["primaryColor", "accentColor"])
      if (
        typeof normalized[key] !== "string" ||
        !/^#[0-9a-f]{6}$/i.test(normalized[key])
      )
        return null;
    for (const key of ["logoUrl", "coverUrl", "loginAnimationUrl"])
      if (
        normalized[key] !== null &&
        (typeof normalized[key] !== "string" ||
          !assetPath.test(normalized[key]))
      )
        return null;
    if (!Number.isSafeInteger(normalized.version) || normalized.version < 0)
      return null;
    return Object.fromEntries(
      fields.map((key) => [key, normalized[key]]),
    ) as TenantBranding;
  } catch {
    return null;
  }
}
/** Pick the higher-contrast text color without trusting arbitrary CSS values. */
export function brandingForeground(color: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return "#ffffff";
  const channels = [1, 3, 5]
    .map((offset) => parseInt(color.slice(offset, offset + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const luminance =
    channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05)
    ? "#000000"
    : "#ffffff";
}
