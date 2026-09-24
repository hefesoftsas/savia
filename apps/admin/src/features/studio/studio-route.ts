export const STUDIO_PATH = "/studio";
export const STUDIO_LEGACY_PATH = "/crm";

/** Fase 1: #/studio es la ruta canónica; #/crm se mantiene como alias legacy. */
export function isStudioLocation(pathname: string): boolean {
  return pathname === STUDIO_PATH || pathname === STUDIO_LEGACY_PATH;
}
