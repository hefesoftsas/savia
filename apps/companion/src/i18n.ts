export const locales = ["es", "en", "pt"] as const;

export type Locale = (typeof locales)[number];

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

/** Use the current OS/browser language at every launch; manual choices stay in memory. */
export function loadLocale(navigatorLanguage?: string): Locale {
  return detectLocale(
    navigatorLanguage ??
      (typeof navigator !== "undefined" ? navigator.language : undefined),
  );
}

/** Format a captured track duration with the active UI locale. */
export function formatDuration(locale: Locale, seconds: number): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(seconds);
}

/** Default recording-session name: local day + hour, e.g. "Feb 14, 2026, 3:45 PM". */
export function defaultSessionName(
  locale: Locale,
  now: Date = new Date(),
): string {
  return now.toLocaleString(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** Trimmed session name sent to the backend. */
export function normalizeSessionName(value: string): string {
  return value.trim();
}

/** Session names require 1..255 chars after trimming. */
export function isValidSessionName(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length >= 1 && trimmed.length <= 255;
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
    es: "Las credenciales quedan en memoria salvo que elijas recordarlas.",
    en: "Credentials stay in memory unless you choose to remember them.",
    pt: "As credenciais ficam na memória, a menos que você opte por lembrá-las.",
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
  "Export diagnostic log": {
    es: "Exportar registro de diagnóstico",
    en: "Export diagnostic log",
    pt: "Exportar registro de diagnóstico",
  },
  "Exporting diagnostics…": {
    es: "Exportando diagnóstico…",
    en: "Exporting diagnostics…",
    pt: "Exportando diagnóstico…",
  },
  "Export a diagnostic log to Downloads to share with support. API keys and audio are excluded.":
    {
      es: "Exporta un registro a Descargas para compartirlo con soporte. No incluye claves API ni audio.",
      en: "Export a diagnostic log to Downloads to share with support. API keys and audio are excluded.",
      pt: "Exporte um registro para Downloads e compartilhe com o suporte. Não inclui chaves API nem áudio.",
    },
  "Saved in Downloads: {filename}": {
    es: "Guardado en Descargas: {filename}",
    en: "Saved in Downloads: {filename}",
    pt: "Salvo em Downloads: {filename}",
  },
  "Unable to export diagnostics. Try again.": {
    es: "No se pudo exportar el diagnóstico. Inténtalo de nuevo.",
    en: "Unable to export diagnostics. Try again.",
    pt: "Não foi possível exportar o diagnóstico. Tente novamente.",
  },
  "Remember on this device": {
    es: "Recordar en este equipo",
    en: "Remember on this device",
    pt: "Lembrar neste dispositivo",
  },
  "Stored in the system keychain.": {
    es: "Se guarda en el llavero del sistema.",
    en: "Stored in the system keychain.",
    pt: "É salva no gerenciador de credenciais do sistema.",
  },
  "Forget saved credential": {
    es: "Olvidar credencial guardada",
    en: "Forget saved credential",
    pt: "Esquecer credencial salva",
  },
  "Unable to save the credential on this device.": {
    es: "No se pudo guardar la credencial en este equipo.",
    en: "Unable to save the credential on this device.",
    pt: "Não foi possível salvar a credencial neste dispositivo.",
  },
  "Unable to read the saved credential. Check access to the system keychain and try again.":
    {
      es: "No se pudo leer la credencial guardada. Revisa el acceso al llavero del sistema e inténtalo de nuevo.",
      en: "Unable to read the saved credential. Check access to the system keychain and try again.",
      pt: "Não foi possível ler a credencial salva. Verifique o acesso ao gerenciador de credenciais do sistema e tente novamente.",
    },
  "Unable to forget the saved credential.": {
    es: "No se pudo olvidar la credencial guardada.",
    en: "Unable to forget the saved credential.",
    pt: "Não foi possível esquecer a credencial salva.",
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
  "Session name": {
    es: "Nombre de la sesión",
    en: "Session name",
    pt: "Nome da sessão",
  },
  "Name this recording": {
    es: "Nombra esta grabación",
    en: "Name this recording",
    pt: "Nomeie esta gravação",
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
    es: "Tengo permiso para subir esta grabación a Savia.",
    en: "I have permission to upload this recording to Savia.",
    pt: "Tenho permissão para enviar esta gravação ao Savia.",
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
  "Loading preview": {
    es: "Cargando vista previa",
    en: "Loading preview",
    pt: "Carregando pré-visualização",
  },
  "Preview on this device before uploading": {
    es: "Escucha el audio en este dispositivo antes de subirlo",
    en: "Preview on this device before uploading",
    pt: "Ouça o áudio neste dispositivo antes de enviá-lo",
  },
  Preview: {
    es: "Vista previa",
    en: "Preview",
    pt: "Pré-visualizar",
  },
  "Preview microphone": {
    es: "Vista previa del micrófono",
    en: "Preview microphone",
    pt: "Pré-visualizar o microfone",
  },
  "Preview system audio": {
    es: "Vista previa del audio del sistema",
    en: "Preview system audio",
    pt: "Pré-visualizar o áudio do sistema",
  },
  Paused: {
    es: "En pausa",
    en: "Paused",
    pt: "Pausada",
  },
  "Resume recording": {
    es: "Reanudar grabación",
    en: "Resume recording",
    pt: "Retomar gravação",
  },
  Pause: {
    es: "Pausar",
    en: "Pause",
    pt: "Pausar",
  },
  Finish: {
    es: "Finalizar",
    en: "Finish",
    pt: "Concluir",
  },
  "Recording is paused. Resume to keep adding to the same take.": {
    es: "La grabación está en pausa. Reanúdala para seguir en la misma toma.",
    en: "Recording is paused. Resume to keep adding to the same take.",
    pt: "A gravação está pausada. Retome para continuar na mesma tomada.",
  },
  CAPTURE_PERMISSION_DENIED_MICROPHONE: {
    es: "Revisa los permisos del micrófono en la configuración del sistema.",
    en: "Check microphone permissions in system settings.",
    pt: "Verifique as permissões do microfone nas configurações do sistema.",
  },
  CAPTURE_PERMISSION_DENIED_SYSTEM: {
    es: "Revisa los permisos de captura de audio del sistema.",
    en: "Check system-audio capture permissions.",
    pt: "Verifique as permissões de captura de áudio do sistema.",
  },
  CAPTURE_UNAVAILABLE: {
    es: "La captura de audio no está disponible en este dispositivo.",
    en: "Audio capture is unavailable on this device.",
    pt: "A captura de áudio não está disponível neste dispositivo.",
  },
  CAPTURE_PENDING_DRAFT: {
    es: "Hay un borrador pendiente. Descartarlo elimina el audio local de ese borrador y permite iniciar otra grabación.",
    en: "A draft is pending. Discarding it removes that draft's local audio and lets you start another recording.",
    pt: "Há um rascunho pendente. Descartá-lo remove o áudio local desse rascunho e permite iniciar outra gravação.",
  },
  CAPTURE_FAILED: {
    es: "No se pudo completar la captura de audio.",
    en: "Audio capture could not be completed.",
    pt: "Não foi possível concluir a captura de áudio.",
  },
  OPERATION_FAILED: {
    es: "No se pudo completar esta acción.",
    en: "This action could not be completed.",
    pt: "Não foi possível concluir esta ação.",
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
    es: "El audio solo se sube cuando eliges Subir. La copia local permanece aquí hasta que la elimines.",
    en: "Audio is uploaded only when you choose Upload. The local copy stays here until you delete it.",
    pt: "O áudio só é enviado quando você escolhe Enviar. A cópia local fica aqui até você excluí-la.",
  },
  "More information": {
    es: "Más información",
    en: "More information",
    pt: "Mais informações",
  },
  "Local meetings": {
    es: "Reuniones locales",
    en: "Local meetings",
    pt: "Reuniões locais",
  },
  "Local meetings help": {
    es: "Las grabaciones permanecen en este dispositivo. Elige una para revisarla, subirla o eliminarla.",
    en: "Recordings stay on this device. Select one to review, upload, or delete it.",
    pt: "As gravações ficam neste dispositivo. Selecione uma para revisar, enviar ou excluir.",
  },
  "No local meetings": {
    es: "Todavía no hay reuniones guardadas en este dispositivo.",
    en: "There are no meetings saved on this device yet.",
    pt: "Ainda não há reuniões salvas neste dispositivo.",
  },
  "New meeting": {
    es: "Nueva reunión",
    en: "New meeting",
    pt: "Nova reunião",
  },
  "Opening meeting": {
    es: "Abriendo reunión",
    en: "Opening meeting",
    pt: "Abrindo reunião",
  },
  "Saving meeting name": {
    es: "Guardando nombre de la reunión",
    en: "Saving meeting name",
    pt: "Salvando nome da reunião",
  },
  "Deleting meeting": {
    es: "Eliminando reunión",
    en: "Deleting meeting",
    pt: "Excluindo reunião",
  },
  "Select meeting": {
    es: "Seleccionar reunión",
    en: "Select meeting",
    pt: "Selecionar reunião",
  },
  Delete: {
    es: "Eliminar",
    en: "Delete",
    pt: "Excluir",
  },
  "Delete meeting": {
    es: "Eliminar reunión",
    en: "Delete meeting",
    pt: "Excluir reunião",
  },
  "Keep meeting": {
    es: "Conservar reunión",
    en: "Keep meeting",
    pt: "Manter reunião",
  },
  "Confirm meeting deletion": {
    es: "Confirmar eliminación de la reunión",
    en: "Confirm meeting deletion",
    pt: "Confirmar exclusão da reunião",
  },
  "Delete meeting consequence": {
    es: "Se eliminarán de este dispositivo la reunión y su audio local. La copia que ya subiste a Savia seguirá allí.",
    en: "This removes the meeting and its local audio from this device. Any copy already uploaded to Savia stays there.",
    pt: "A reunião e o áudio local serão removidos deste dispositivo. Uma cópia já enviada ao Savia continuará lá.",
  },
  Uploaded: {
    es: "Subida a",
    en: "Uploaded to",
    pt: "Enviada para",
  },
  "Uploaded to Savia": {
    es: "Subida a Savia",
    en: "Uploaded to Savia",
    pt: "Enviada ao Savia",
  },
  Interrupted: {
    es: "Interrumpida",
    en: "Interrupted",
    pt: "Interrompida",
  },
  Unavailable: {
    es: "No disponible",
    en: "Unavailable",
    pt: "Indisponível",
  },
  Ready: {
    es: "Lista",
    en: "Ready",
    pt: "Pronta",
  },
  "Active audio sources": {
    es: "Fuentes de audio activas",
    en: "Active audio sources",
    pt: "Fontes de áudio ativas",
  },
  Active: {
    es: "Activa",
    en: "Active",
    pt: "Ativa",
  },
  Captured: {
    es: "Capturada",
    en: "Captured",
    pt: "Capturada",
  },
  "Meeting data unavailable": {
    es: "No se puede leer esta reunión. Puedes eliminar su copia local.",
    en: "This meeting cannot be read. You can remove its local copy.",
    pt: "Não foi possível ler esta reunião. Você pode remover a cópia local.",
  },
  "Microphone partial warning": {
    es: "El micrófono no pudo iniciarse. La grabación continúa con la otra fuente disponible.",
    en: "The microphone could not start. Recording continues with the other available source.",
    pt: "Não foi possível iniciar o microfone. A gravação continua com a outra fonte disponível.",
  },
  "System audio partial warning": {
    es: "El audio del sistema no pudo iniciarse. La grabación continúa con la otra fuente disponible.",
    en: "System audio could not start. Recording continues with the other available source.",
    pt: "Não foi possível iniciar o áudio do sistema. A gravação continua com a outra fonte disponível.",
  },
  "Recording and upload permission": {
    es: "Permiso para grabar y subir",
    en: "Recording and upload permission",
    pt: "Permissão para gravar e enviar",
  },
  "Permission disclaimer body": {
    es: "Graba y sube únicamente reuniones para las que tienes autorización de los participantes. Al elegir Subir a Savia confirmas que tienes permiso para guardar ese audio en Savia. Esta aceptación se recuerda en este dispositivo; puedes restablecerla en Ajustes. Ninguna reunión se sube automáticamente.",
    en: "Only record and upload meetings you have permission from the participants to capture. Choosing Upload to Savia confirms you have permission to store that recording in Savia. This acknowledgement is remembered on this device and can be reset in Settings. No meeting is uploaded automatically.",
    pt: "Grave e envie apenas reuniões que você tem autorização dos participantes para capturar. Ao escolher Enviar ao Savia, você confirma que tem permissão para armazenar essa gravação no Savia. Esta confirmação é lembrada neste dispositivo e pode ser redefinida nas configurações. Nenhuma reunião é enviada automaticamente.",
  },
  "Accept and remember": {
    es: "Aceptar y recordar",
    en: "Accept and remember",
    pt: "Aceitar e lembrar",
  },
  "Not now": { es: "Ahora no", en: "Not now", pt: "Agora não" },
  "Review permission notice": {
    es: "Restablecer aviso de permisos",
    en: "Reset permission notice",
    pt: "Redefinir aviso de permissão",
  },
  "Edit meeting name": {
    es: "Editar nombre de la reunión",
    en: "Edit meeting name",
    pt: "Editar nome da reunião",
  },
  "Save name": { es: "Guardar nombre", en: "Save name", pt: "Salvar nome" },
  "Cancel editing": {
    es: "Cancelar edición",
    en: "Cancel editing",
    pt: "Cancelar edição",
  },
  "Meeting name length": {
    es: "Escribe un nombre de 1 a 255 caracteres.",
    en: "Enter a name with 1 to 255 characters.",
    pt: "Digite um nome de 1 a 255 caracteres.",
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
