export type Locale = "es" | "en" | "pt";
const messages: Record<string, [string, string, string]> = {
  connect: ["Conectar con Savia", "Connect to Savia", "Conectar ao Savia"],
  newConnection: ["Nueva conexión", "New connection", "Nova conexão"],
  server: ["Origen del servidor", "Server origin", "Origem do servidor"],
  workspaceId: [
    "ID del espacio de trabajo",
    "Workspace ID",
    "ID do espaço de trabalho",
  ],
  key: ["Clave API personal", "Personal API key", "Chave API pessoal"],
  keyHint: [
    "Selecciona plugins:read y plugins:publish en Savia. La clave se guarda en SecretStorage.",
    "Select plugins:read and plugins:publish in Savia. The key is stored in SecretStorage.",
    "Selecione plugins:read e plugins:publish no Savia. A chave é salva no SecretStorage.",
  ],
  originError: [
    "Usa un origen HTTPS; HTTP solo en localhost.",
    "Use an HTTPS origin; HTTP is supported only on loopback.",
    "Use uma origem HTTPS; HTTP somente em localhost.",
  ],
  workspaceError: [
    "Selecciona un ID comercial mayor que cero.",
    "Select a commercial workspace ID greater than zero.",
    "Selecione um ID de espaço comercial maior que zero.",
  ],
  connected: [
    "Conectado a %{workspace}",
    "Connected to %{workspace}",
    "Conectado a %{workspace}",
  ],
  disconnected: [
    "Conexión cerrada; la clave guardada fue eliminada.",
    "Disconnected; the saved key was deleted.",
    "Conexão encerrada; a chave salva foi excluída.",
  ],
  sourceScopeRequired: [
    "La clave no permite leer fuentes. Usa plugins:read para explorar plugins.",
    "This key cannot read source. Use plugins:read to browse plugins.",
    "A chave não permite ler fontes. Use plugins:read para explorar plugins.",
  ],
  compiledOnly: [
    "Esta versión solo conserva JavaScript compilado y se abre en modo lectura.",
    "This version retains only compiled JavaScript and opens read-only.",
    "Esta versão contém apenas JavaScript compilado e abre somente para leitura.",
  ],
  checkoutReady: [
    "Fuentes de %{pluginId}@%{version} descargadas. Guardar archivos no publica cambios.",
    "Checked out %{pluginId}@%{version}. Saving files does not publish changes.",
    "Fontes de %{pluginId}@%{version} baixadas. Salvar arquivos não publica alterações.",
  ],
  buildReady: [
    "Compilación verificada: %{pluginId}",
    "Build verified: %{pluginId}",
    "Compilação verificada: %{pluginId}",
  ],
  published: [
    "Publicada %{pluginId}@%{version}. Última local: %{latest}. Última en el store: %{sharedLatest}.",
    "Published %{pluginId}@%{version}. Latest locally: %{latest}. Latest in the store: %{sharedLatest}.",
    "Publicada %{pluginId}@%{version}. Última local: %{latest}. Última na loja: %{sharedLatest}.",
  ],
  "shared-pending": [
    "%{pluginId}@%{version} quedó guardada localmente. La publicación en el store sigue pendiente; reintenta el ZIP conservado.",
    "%{pluginId}@%{version} is retained locally. Store publication remains pending; retry the retained ZIP.",
    "%{pluginId}@%{version} foi salva localmente. A publicação na loja está pendente; tente novamente o ZIP preservado.",
  ],
  "shared-conflict": [
    "%{pluginId}@%{version} quedó guardada localmente. Hay un conflicto con el store; compara las versiones antes de reintentar.",
    "%{pluginId}@%{version} is retained locally. The store has a conflict; compare versions before retrying.",
    "%{pluginId}@%{version} foi salva localmente. Há um conflito com a loja; compare as versões antes de tentar novamente.",
  ],
  receiptNotRecorded: [
    "La publicación fue confirmada; no se pudo guardar el recibo local. El ZIP se conserva.",
    "Publication was confirmed; the local receipt could not be saved. The ZIP is retained.",
    "A publicação foi confirmada; não foi possível salvar o recibo local. O ZIP foi preservado.",
  ],
  confirmBase: [
    "Actualizar la base de %{pluginId} a %{version}",
    "Update %{pluginId}'s publication base to %{version}",
    "Atualizar a base de %{pluginId} para %{version}",
  ],
  keepLocalFiles: [
    "Se actualizará solo la referencia de publicación. Tus archivos locales conservarán todos los cambios.",
    "Only the publication reference will change. Local files will retain all changes.",
    "Somente a referência de publicação será alterada. Os arquivos locais manterão todas as alterações.",
  ],
  baselineNotUpdated: [
    "La publicación fue confirmada; no se pudo actualizar la base local. Compara y actualízala explícitamente.",
    "Publication was confirmed; the local base could not be updated. Compare and update it explicitly.",
    "A publicação foi confirmada; não foi possível atualizar a base local. Compare e atualize-a explicitamente.",
  ],
  reviewBeforeRebase: [
    "Revisa la comparación con la última versión antes de cambiar la base. Tus archivos se conservarán.",
    "Review the latest-version comparison before changing the base. Your files will be preserved.",
    "Revise a comparação com a versão mais recente antes de mudar a base. Seus arquivos serão preservados.",
  ],
  baseUpdated: [
    "Base actualizada. Los archivos locales conservan tus cambios.",
    "Publication base updated. Local files retain your changes.",
    "Base atualizada. Os arquivos locais mantêm suas alterações.",
  ],
  folder: [
    "Selecciona una carpeta vacía para las fuentes",
    "Select an empty source folder",
    "Selecione uma pasta vazia para as fontes",
  ],
  root: [
    "Selecciona el proyecto que quieres usar",
    "Select the project to use",
    "Selecione o projeto que deseja usar",
  ],
  plugin: [
    "Selecciona un plugin publicado",
    "Select a published plugin",
    "Selecione um plugin publicado",
  ],
  noPlugins: [
    "No hay plugins publicados en este espacio. Publícalos o impórtalos desde Savia.",
    "This workspace has no published plugins. Publish or import them in Savia.",
    "Não há plugins publicados neste espaço. Publique ou importe-os no Savia.",
  ],
  sourceFile: [
    "Selecciona un archivo de la versión publicada",
    "Select a published source file",
    "Selecione um arquivo da versão publicada",
  ],
  destination: [
    "Destino de la publicación",
    "Publication destination",
    "Destino da publicação",
  ],
  tenant: ["Espacio de trabajo", "Workspace", "Espaço de trabalho"],
  shared: ["Store compartido", "Shared store", "Loja compartilhada"],
  version: ["Nueva versión", "New version", "Nova versão"],
  versionHint: [
    "Debe ser mayor que %{minimum} (mayor.menor.parche).",
    "Must be greater than %{minimum} (major.minor.patch).",
    "Deve ser maior que %{minimum} (maior.menor.patch).",
  ],
  publish: ["Publicar", "Publish", "Publicar"],
  retry: [
    "Reintentar el ZIP conservado",
    "Retry retained ZIP",
    "Tentar novamente o ZIP preservado",
  ],
  updateBase: [
    "Actualizar la base",
    "Update publication base",
    "Atualizar a base",
  ],
  confirm: [
    "Publicar %{pluginId}@%{version} en %{target}",
    "Publish %{pluginId}@%{version} to %{target}",
    "Publicar %{pluginId}@%{version} em %{target}",
  ],
  sourceBase: [
    "Base: %{sourceVersion}. ZIP: %{sha256}",
    "Base: %{sourceVersion}. ZIP: %{sha256}",
    "Base: %{sourceVersion}. ZIP: %{sha256}",
  ],
  changes: ["Cambios incluidos:", "Included changes:", "Alterações incluídas:"],
  retained: [
    "Se enviará el ZIP original. Los cambios posteriores no se incluirán.",
    "The original ZIP will be sent. Later edits will not be included.",
    "O ZIP original será enviado. Alterações posteriores não serão incluídas.",
  ],
  noActivation: [
    "La activación se realiza explícitamente en Savia.",
    "Activate explicitly in Savia.",
    "Ative explicitamente no Savia.",
  ],
  openSavia: ["Abrir Savia", "Open Savia", "Abrir Savia"],
  compare: [
    "Comparar con la última versión",
    "Compare with latest version",
    "Comparar com a versão mais recente",
  ],
  recover: [
    "Recuperar publicación",
    "Recover publication",
    "Recuperar publicação",
  ],
  noAttempts: [
    "No hay publicaciones pendientes para recuperar.",
    "There are no pending publications to recover.",
    "Não há publicações pendentes para recuperar.",
  ],
  selectAttempt: [
    "Selecciona el ZIP conservado que quieres recuperar",
    "Select the retained ZIP to recover",
    "Selecione o ZIP preservado que deseja recuperar",
  ],
  latest: ["Última", "Latest", "Mais recente"],
  installed: ["Instalada", "Installed", "Instalada"],
  compiled: ["Compilado", "Compiled", "Compilado"],
  yes: ["sí", "yes", "sim"],
  no: ["no", "no", "não"],
  unknown: ["sin comprobar", "not checked", "não verificada"],
  failed: [
    "No se pudo completar la operación. %{message}",
    "Could not complete the operation. %{message}",
    "Não foi possível concluir a operação. %{message}",
  ],
  working: ["Savia: procesando…", "Savia: working…", "Savia: processando…"],
};
export function localeFor(language: string): Locale {
  return language.toLowerCase().startsWith("es")
    ? "es"
    : language.toLowerCase().startsWith("pt")
      ? "pt"
      : "en";
}
export function translator(locale: Locale) {
  const index = locale === "es" ? 0 : locale === "en" ? 1 : 2;
  return (key: string, values: Record<string, string> = {}) =>
    (messages[key]?.[index] ?? key).replace(
      /%\{([^}]+)\}/g,
      (_match, name: string) => values[name] ?? "",
    );
}
