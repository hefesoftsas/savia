export const locales = ["es", "en", "pt"] as const;

export type Locale = (typeof locales)[number];

export const LOCALE_STORAGE_KEY = "savia-companion-locale";

const SAVIA_LOCALES: Record<string, Locale> = {
  es: "es",
  en: "en",
  pt: "pt",
};

export function isLocale(value: unknown): value is Locale {
  return (
    typeof value === "string" && (locales as readonly string[]).includes(value)
  );
}

/** Map a BCP 47 tag to a supported locale, defaulting to Spanish. */
export function detectLocale(tag: string | undefined | null): Locale {
  if (typeof tag === "string") {
    const primary = tag.trim().toLowerCase().split(/[-_]/)[0];
    const match = SAVIA_LOCALES[primary];
    if (match) return match;
  }
  return "es";
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function ambientStorage(): StorageLike | undefined {
  try {
    if (typeof localStorage !== "undefined") return localStorage;
  } catch {
    // Private browsing or non-DOM runtimes have no usable storage.
  }
  return undefined;
}

/**
 * Stored locale wins; otherwise detect from the OS/browser language once and
 * persist it so later OS changes do not flip the app unexpectedly.
 */
export function loadLocale(
  storage: StorageLike | undefined = ambientStorage(),
  navigatorLanguage?: string,
): Locale {
  const stored = storage?.getItem(LOCALE_STORAGE_KEY);
  if (isLocale(stored)) return stored;
  const detected = detectLocale(
    navigatorLanguage ??
      (typeof navigator !== "undefined" ? navigator.language : undefined),
  );
  try {
    storage?.setItem(LOCALE_STORAGE_KEY, detected);
  } catch {
    // Storage is a best effort; the detected locale still applies.
  }
  return detected;
}

export function saveLocale(
  locale: Locale,
  storage: StorageLike | undefined = ambientStorage(),
): void {
  try {
    storage?.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Ignore persistence failures; the selection still applies in memory.
  }
}

const messages = {
  Connected: {
    es: "Conectado",
    en: "Connected",
    pt: "Conectado",
  },
  "Not connected": {
    es: "Sin conectar",
    en: "Not connected",
    pt: "Não conectado",
  },
  "Open in Savia": {
    es: "Abrir en Savia",
    en: "Open in Savia",
    pt: "Abrir no Savia",
  },
  "Open connection settings": {
    es: "Abrir ajustes de conexión",
    en: "Open connection settings",
    pt: "Abrir configurações de conexão",
  },
  "Close connection settings": {
    es: "Cerrar ajustes de conexión",
    en: "Close connection settings",
    pt: "Fechar configurações de conexão",
  },
  "Connection settings": {
    es: "Ajustes de conexión",
    en: "Connection settings",
    pt: "Configurações de conexão",
  },
  "Close settings": {
    es: "Cerrar ajustes",
    en: "Close settings",
    pt: "Fechar configurações",
  },
  "Preview only · Open the desktop app to record audio.": {
    es: "Solo vista previa · Abre la app de escritorio para grabar audio.",
    en: "Preview only · Open the desktop app to record audio.",
    pt: "Somente pré-visualização · Abra o app de desktop para gravar áudio.",
  },
  "Connect to Savia": {
    es: "Conectar con Savia",
    en: "Connect to Savia",
    pt: "Conectar ao Savia",
  },
  "Credentials stay in memory for this session.": {
    es: "Las credenciales quedan en memoria solo en esta sesión.",
    en: "Credentials stay in memory for this session.",
    pt: "As credenciais ficam na memória apenas nesta sessão.",
  },
  Done: {
    es: "Listo",
    en: "Done",
    pt: "OK",
  },
  "API address": {
    es: "Dirección de la API",
    en: "API address",
    pt: "Endereço da API",
  },
  "Savia API key or access token": {
    es: "Clave API o token de acceso de Savia",
    en: "Savia API key or access token",
    pt: "Chave API ou token de acesso do Savia",
  },
  "Paste your Savia credential": {
    es: "Pega tu credencial de Savia",
    en: "Paste your Savia credential",
    pt: "Cole sua credencial do Savia",
  },
  "Savia app address": {
    es: "Dirección de la app Savia",
    en: "Savia app address",
    pt: "Endereço do app Savia",
  },
  "Opens the private recording review page.": {
    es: "Abre la página privada de revisión de grabaciones.",
    en: "Opens the private recording review page.",
    pt: "Abre a página privada de revisão de gravações.",
  },
  Language: {
    es: "Idioma",
    en: "Language",
    pt: "Idioma",
  },
  Connect: {
    es: "Conectar",
    en: "Connect",
    pt: "Conectar",
  },
  Reconnect: {
    es: "Reconectar",
    en: "Reconnect",
    pt: "Reconectar",
  },
  "Checking connection": {
    es: "Comprobando conexión",
    en: "Checking connection",
    pt: "Verificando conexão",
  },
  "Connected to Savia.": {
    es: "Conectado a Savia.",
    en: "Connected to Savia.",
    pt: "Conectado ao Savia.",
  },
  "Connected, but private audio storage is unavailable on this server.": {
    es: "Conectado, pero el almacenamiento privado de audio no está disponible en este servidor.",
    en: "Connected, but private audio storage is unavailable on this server.",
    pt: "Conectado, mas o armazenamento privado de áudio não está disponível neste servidor.",
  },
  "Opening Savia": {
    es: "Abriendo Savia",
    en: "Opening Savia",
    pt: "Abrindo o Savia",
  },
  "Starting recording": {
    es: "Iniciando grabación",
    en: "Starting recording",
    pt: "Iniciando gravação",
  },
  "Finalizing audio": {
    es: "Finalizando audio",
    en: "Finalizing audio",
    pt: "Finalizando áudio",
  },
  "Discarding audio": {
    es: "Descartando audio",
    en: "Discarding audio",
    pt: "Descartando áudio",
  },
  "Uploading to Savia": {
    es: "Subiendo a Savia",
    en: "Uploading to Savia",
    pt: "Enviando ao Savia",
  },
  "Upload progress": {
    es: "Subiendo {uploaded} de {total}",
    en: "Uploading {uploaded} of {total}",
    pt: "Enviando {uploaded} de {total}",
  },
  "Connect storage and confirm permission before upload.": {
    es: "Conecta el almacenamiento y confirma el permiso antes de subir.",
    en: "Connect storage and confirm permission before upload.",
    pt: "Conecte o armazenamento e confirme a permissão antes de enviar.",
  },
  "No recoverable audio is available to upload.": {
    es: "No hay audio recuperable para subir.",
    en: "No recoverable audio is available to upload.",
    pt: "Não há áudio recuperável para enviar.",
  },
  "Audio saved privately in Savia.": {
    es: "Audio guardado en privado en Savia.",
    en: "Audio saved privately in Savia.",
    pt: "Áudio salvo em privado no Savia.",
  },
  "Recording name": {
    es: "Grabación {id}",
    en: "Recording {id}",
    pt: "Gravação {id}",
  },
  "Recording status": {
    es: "Estado de grabación",
    en: "Recording status",
    pt: "Status da gravação",
  },
  Recording: {
    es: "Grabando",
    en: "Recording",
    pt: "Gravando",
  },
  "Ready to upload": {
    es: "Lista para subir",
    en: "Ready to upload",
    pt: "Pronta para enviar",
  },
  "Saved to Savia": {
    es: "Guardada en Savia",
    en: "Saved to Savia",
    pt: "Salva no Savia",
  },
  "Capture needs attention": {
    es: "La captura necesita atención",
    en: "Capture needs attention",
    pt: "A captura precisa de atenção",
  },
  "Ready to record": {
    es: "Lista para grabar",
    en: "Ready to record",
    pt: "Pronta para gravar",
  },
  "Seconds recorded": {
    es: "{seconds} segundos grabados",
    en: "{seconds} seconds recorded",
    pt: "{seconds} segundos gravados",
  },
  "Recording time": {
    es: "Tiempo de grabación",
    en: "Recording time",
    pt: "Tempo de gravação",
  },
  "Recording stays on device": {
    es: "Tu audio queda en este dispositivo hasta que lo subas.",
    en: "Your audio stays on this device until you upload it.",
    pt: "Seu áudio fica neste dispositivo até você enviá-lo.",
  },
  "Review before upload": {
    es: "Revisa las fuentes capturadas y sube cuando esté listo.",
    en: "Check the captured sources, then upload when ready.",
    pt: "Confira as fontes capturadas e envie quando estiver pronto.",
  },
  "Capture trouble": {
    es: "Revisa el mensaje abajo e intenta con otra grabación.",
    en: "Review the message below, then try another recording.",
    pt: "Confira a mensagem abaixo e tente outra gravação.",
  },
  "Capture up to one hour": {
    es: "Captura hasta una hora desde tus fuentes elegidas.",
    en: "Capture up to one hour from your selected sources.",
    pt: "Capture até uma hora das suas fontes selecionadas.",
  },
  "Captured audio": {
    es: "Audio capturado",
    en: "Captured audio",
    pt: "Áudio capturado",
  },
  Microphone: {
    es: "Micrófono",
    en: "Microphone",
    pt: "Microfone",
  },
  "System audio": {
    es: "Audio del sistema",
    en: "System audio",
    pt: "Áudio do sistema",
  },
  "Track details": {
    es: "{duration} seg · {size} KB",
    en: "{duration} sec · {size} KB",
    pt: "{duration} s · {size} KB",
  },
  "Recovered recording": {
    es: "Se recuperó una grabación guardada de este dispositivo. Revísala y súbela cuando esté lista.",
    en: "Recovered a saved recording from this device. Review it and upload when ready.",
    pt: "Uma gravação salva deste dispositivo foi recuperada. Confira e envie quando estiver pronta.",
  },
  "Recording is available in the desktop app.": {
    es: "La grabación está disponible en la app de escritorio.",
    en: "Recording is available in the desktop app.",
    pt: "A gravação está disponível no app de desktop.",
  },
  "Capture sources": {
    es: "Fuentes de captura",
    en: "Capture sources",
    pt: "Fontes de captura",
  },
  "Recording consent": {
    es: "Tengo permiso para grabar y guardar esta grabación en Savia.",
    en: "I have permission to record and store this recording in Savia.",
    pt: "Tenho permissão para gravar e salvar esta gravação no Savia.",
  },
  "Stop recording": {
    es: "Detener grabación",
    en: "Stop recording",
    pt: "Parar gravação",
  },
  "Upload to Savia": {
    es: "Subir a Savia",
    en: "Upload to Savia",
    pt: "Enviar ao Savia",
  },
  "Start recording": {
    es: "Iniciar grabación",
    en: "Start recording",
    pt: "Iniciar gravação",
  },
  Discard: {
    es: "Descartar",
    en: "Discard",
    pt: "Descartar",
  },
  "Storage unavailable guidance": {
    es: "Conecta un servidor Savia con almacenamiento de grabaciones activado.",
    en: "Connect a Savia server with recording storage enabled.",
    pt: "Conecte um servidor Savia com armazenamento de gravações ativado.",
  },
  "Upload permission guidance": {
    es: "Esta clave no puede subir grabaciones. Conéctate con permiso recordings:upload.",
    en: "This key cannot upload recordings. Connect with recordings:upload permission.",
    pt: "Esta chave não pode enviar gravações. Conecte-se com permissão recordings:upload.",
  },
  "Consent guidance": {
    es: "Confirma el permiso para activar la subida.",
    en: "Confirm permission to enable upload.",
    pt: "Confirme a permissão para ativar o envio.",
  },
  "Review recording in Savia": {
    es: "Revisar grabación en Savia",
    en: "Review recording in Savia",
    pt: "Revisar gravação no Savia",
  },
  "Audio stays on device": {
    es: "Ningún audio sale de este dispositivo hasta que elijas Subir.",
    en: "No audio leaves this device until you choose Upload.",
    pt: "Nenhum áudio sai deste dispositivo até você escolher Enviar.",
  },
  Attribution: {
    es: "Savia — Desarrollado por Hefesoft SAS, Colombia.",
    en: "Savia — Developed by Hefesoft SAS, Colombia.",
    pt: "Savia — Desenvolvido por Hefesoft SAS, Colômbia.",
  },
} as const;

export type MessageKey = keyof typeof messages;

export const messageKeys = Object.keys(messages) as MessageKey[];

export function translate(
  locale: Locale,
  key: MessageKey,
  vars?: Record<string, string | number>,
): string {
  let text: string = messages[key][locale];
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.replaceAll(`{${name}}`, String(value));
    }
  }
  return text;
}
