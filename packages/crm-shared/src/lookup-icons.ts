import { THESVG_ICON_IDS } from "./thesvg-icon-ids";
import { LUCIDE_ICON_IDS } from "./lucide-icon-ids";

export type LookupIconLibrary = "lucide" | "thesvg";

export const LOOKUP_ICON_SEARCH_MIN_LENGTH = 2;

const LOOKUP_ICON_LABEL_OVERRIDES: Record<string, string> = {
  search: "Lupa",
  "scan-search": "Escanear",
  "file-search": "Buscar archivo",
  "refresh-cw": "Actualizar",
  "arrow-right": "Flecha",
  zap: "Rayo",
  car: "Vehículo",
  "car-front": "Auto",
  truck: "Camión",
  bike: "Bicicleta",
  user: "Usuario",
  users: "Usuarios",
  "user-round": "Persona",
  "user-plus": "Agregar usuario",
  "user-check": "Usuario verificado",
  phone: "Teléfono",
  mail: "Correo",
  "mail-search": "Buscar correo",
  calendar: "Calendario",
  "calendar-search": "Buscar fecha",
  clock: "Reloj",
  download: "Descargar",
  upload: "Subir",
  check: "Confirmar",
  x: "Cerrar",
  plus: "Agregar",
  minus: "Quitar",
  pencil: "Editar",
  "square-pen": "Editar",
  trash: "Eliminar",
  "trash-2": "Eliminar",
  save: "Guardar",
  send: "Enviar",
  play: "Ejecutar",
  eye: "Ver",
  "eye-off": "Ocultar",
  lock: "Bloquear",
  unlock: "Desbloquear",
  link: "Enlace",
  "external-link": "Abrir enlace",
  database: "Base de datos",
  cloud: "Nube",
  "cloud-download": "Descargar de nube",
  "cloud-upload": "Subir a nube",
  clipboard: "Portapapeles",
  copy: "Copiar",
  filter: "Filtrar",
  "list-filter": "Filtrar lista",
  list: "Lista",
  "list-checks": "Lista con checks",
  map: "Mapa",
  "map-pin": "Ubicación",
  navigation: "Navegar",
  compass: "Brújula",
  building: "Edificio",
  home: "Inicio",
  briefcase: "Negocio",
  wallet: "Cartera",
  "credit-card": "Tarjeta",
  banknote: "Dinero",
  receipt: "Recibo",
  calculator: "Calcular",
  percent: "Porcentaje",
  shield: "Seguro",
  "shield-check": "Verificado",
  badge: "Insignia",
  "badge-check": "Validado",
  fingerprint: "Huella",
  key: "Llave",
  "key-round": "Acceso",
  scan: "Escanear",
  qrcode: "QR",
  barcode: "Código de barras",
  camera: "Cámara",
  image: "Imagen",
  file: "Archivo",
  "file-text": "Documento",
  "file-plus": "Nuevo archivo",
  folder: "Carpeta",
  "folder-open": "Abrir carpeta",
  paperclip: "Adjunto",
  package: "Paquete",
  box: "Caja",
  tag: "Etiqueta",
  tags: "Etiquetas",
  bookmark: "Marcador",
  star: "Favorito",
  heart: "Favorito",
  bell: "Notificación",
  message: "Mensaje",
  "message-circle": "Chat",
  messages: "Mensajes",
  share: "Compartir",
  "share-2": "Compartir",
  globe: "Web",
  wifi: "Conexión",
  settings: "Configuración",
  wrench: "Ajustar",
  hammer: "Herramienta",
  cog: "Configuración",
  info: "Información",
  "circle-help": "Ayuda",
  "help-circle": "Ayuda",
  "alert-circle": "Alerta",
  "triangle-alert": "Advertencia",
  "circle-check": "Correcto",
  "circle-x": "Error",
  sparkles: "Destacar",
  wand: "Automático",
  bot: "Asistente",
  brain: "Inteligente",
  activity: "Actividad",
  chart: "Gráfica",
  "trending-up": "Tendencia",
  target: "Objetivo",
  flag: "Marcar",
  pin: "Fijar",
  anchor: "Anclar",
  route: "Ruta",
  signpost: "Indicación",
  "arrow-up-right": "Ir",
  "move-right": "Continuar",
  "chevrons-right": "Avanzar",
  repeat: "Repetir",
  rotate: "Rotar",
  history: "Historial",
  timer: "Temporizador",
  hourglass: "Espera",
  loader: "Cargando",
};

const THESVG_LABEL_OVERRIDES: Record<string, string> = {
  hubspot: "HubSpot",
  pipedrive: "Pipedrive",
  salesforce: "Salesforce",
  zoho: "Zoho",
  "google-calendar": "Google Calendar",
  "google-drive": "Google Drive",
  gmail: "Gmail",
  "microsoft-excel": "Microsoft Excel",
  "microsoft-outlook": "Microsoft Outlook",
  "microsoft-onedrive": "Microsoft OneDrive",
  "microsoft-teams": "Microsoft Teams",
  "mercado-pago": "Mercado Pago",
  "mercado-libre": "Mercado Libre",
};

export const RECOMMENDED_LOOKUP_ICONS = [
  "search",
  "scan-search",
  "file-search",
  "refresh-cw",
  "arrow-right",
  "zap",
  "car",
  "user",
  "users",
  "phone",
  "mail",
  "calendar",
  "download",
  "upload",
  "check",
  "send",
  "eye",
  "database",
  "clipboard",
  "copy",
  "filter",
  "map-pin",
  "shield-check",
  "file-text",
  "paperclip",
  "settings",
  "sparkles",
] as const;

export const RECOMMENDED_THESVG_LOOKUP_ICONS = [
  "hubspot",
  "pipedrive",
  "salesforce",
  "zoho",
  "google-calendar",
  "google-drive",
  "gmail",
  "microsoft-excel",
  "microsoft-outlook",
  "microsoft-onedrive",
  "microsoft-teams",
  "slack",
  "whatsapp",
  "linkedin",
  "stripe",
  "paypal",
  "mercado-pago",
  "mercado-libre",
  "aws",
  "azure",
  "google-cloud",
  "dropbox",
  "notion",
  "airtable",
  "docusign",
  "adobe",
] as const;

export const LOOKUP_ICON_LIBRARY_LABELS: Record<LookupIconLibrary, string> = {
  lucide: "Interfaz",
  thesvg: "Marcas",
};

function defaultLookupIconLabel(id: string) {
  return id
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function parseLookupIconRef(value: string): {
  library: LookupIconLibrary;
  id: string;
} {
  if (value.startsWith("thesvg:")) {
    return { library: "thesvg", id: value.slice(7) };
  }
  return { library: "lucide", id: value };
}

export function formatLookupIconRef(
  library: LookupIconLibrary,
  id: string,
): string {
  return library === "thesvg" ? `thesvg:${id}` : id;
}

export function lookupIconLibrary(value: string): LookupIconLibrary {
  return parseLookupIconRef(value).library;
}

export function lookupIconLabel(value: string) {
  const parsed = parseLookupIconRef(value);
  if (parsed.library === "thesvg") {
    return (
      THESVG_LABEL_OVERRIDES[parsed.id] ??
      defaultLookupIconLabel(parsed.id)
    );
  }
  return (
    LOOKUP_ICON_LABEL_OVERRIDES[parsed.id] ??
    defaultLookupIconLabel(parsed.id)
  );
}

export const LOOKUP_ICON_IDS = [...LUCIDE_ICON_IDS].sort((left, right) =>
  lookupIconLabel(left).localeCompare(lookupIconLabel(right), "es"),
);

const LUCIDE_ICON_ID_SET = new Set<string>(LUCIDE_ICON_IDS);
const THESVG_ICON_ID_SET = new Set<string>(THESVG_ICON_IDS);

export function isLookupIconId(value: string) {
  const parsed = parseLookupIconRef(value);
  if (parsed.library === "thesvg") {
    return THESVG_ICON_ID_SET.has(parsed.id);
  }
  return LUCIDE_ICON_ID_SET.has(parsed.id);
}

function matchesLookupIconQuery(id: string, normalized: string) {
  return (
    id.includes(normalized) ||
    lookupIconLabel(id).toLowerCase().includes(normalized)
  );
}

const RECOMMENDED_LUCIDE_ICON_SET = new Set<string>(RECOMMENDED_LOOKUP_ICONS);
const RECOMMENDED_THESVG_ICON_SET = new Set<string>(
  RECOMMENDED_THESVG_LOOKUP_ICONS,
);

export function browseLookupIcons(library: LookupIconLibrary = "lucide") {
  if (library === "lucide") {
    const rest = LOOKUP_ICON_IDS.filter(
      (id) => !RECOMMENDED_LUCIDE_ICON_SET.has(id),
    );
    return [...RECOMMENDED_LOOKUP_ICONS, ...rest];
  }

  const recommended = RECOMMENDED_THESVG_LOOKUP_ICONS.map((id) =>
    formatLookupIconRef("thesvg", id),
  );
  const rest = THESVG_ICON_IDS.filter(
    (id) => !RECOMMENDED_THESVG_ICON_SET.has(id),
  ).map((id) => formatLookupIconRef("thesvg", id));
  return [...recommended, ...rest];
}

export function listLookupIcons(
  query: string,
  library: LookupIconLibrary = "lucide",
) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return browseLookupIcons(library);
  }
  if (normalized.length < LOOKUP_ICON_SEARCH_MIN_LENGTH) {
    return [];
  }
  return filterLookupIcons(query, library);
}

export function filterLookupIcons(
  query: string,
  library: LookupIconLibrary = "lucide",
) {
  const normalized = query.trim().toLowerCase();

  if (library === "lucide") {
    if (!normalized) {
      return browseLookupIcons("lucide");
    }
    if (normalized.length < LOOKUP_ICON_SEARCH_MIN_LENGTH) {
      return [];
    }
    return LOOKUP_ICON_IDS.filter((id) =>
      matchesLookupIconQuery(id, normalized),
    );
  }

  if (!normalized) {
    return browseLookupIcons("thesvg");
  }
  if (normalized.length < LOOKUP_ICON_SEARCH_MIN_LENGTH) {
    return [];
  }

  return THESVG_ICON_IDS.filter((id) =>
    matchesLookupIconQuery(formatLookupIconRef("thesvg", id), normalized),
  ).map((id) => formatLookupIconRef("thesvg", id));
}

export function lookupIconCatalogSize(library: LookupIconLibrary) {
  return library === "lucide"
    ? LOOKUP_ICON_IDS.length
    : THESVG_ICON_IDS.length;
}

export { THESVG_ICON_IDS };
