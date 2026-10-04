import type { MessageCatalog } from "@/i18n/core";

export const saveLinkMessages = {
  heading: ["Guardar en Savia", "Save to Savia", "Salvar no Savia"],
  intro: [
    "Conserva el enlace en tus páginas para volver a él después.",
    "Keep the link in your pages to return to it later.",
    "Guarde o link nas suas páginas para consultar depois.",
  ],
  title: ["Título", "Title", "Título"],
  url: ["Enlace", "Link", "Link"],
  note: ["Nota (opcional)", "Note (optional)", "Nota (opcional)"],
  folder: ["Carpeta", "Folder", "Pasta"],
  saved: ["Guardados", "Saved links", "Salvos"],
  defaultFolder: [
    "Guardados · Privado",
    "Saved links · Private",
    "Salvos · Privado",
  ],
  privacy: [
    "Solo tú tendrás acceso. Podrás compartirlo después desde Páginas.",
    "Only you will have access. You can share it later from Pages.",
    "Só você terá acesso. Você pode compartilhar depois em Páginas.",
  ],
  inherited: [
    "Se aplicarán los permisos de la carpeta, incluidos sus enlaces públicos.",
    "The folder's permissions, including its public links, will apply.",
    "Serão aplicadas as permissões da pasta, incluindo os links públicos.",
  ],
  save: ["Guardar enlace", "Save link", "Salvar link"],
  saving: ["Guardando…", "Saving…", "Salvando…"],
  retry: ["Reintentar guardado", "Retry saving", "Tentar salvar novamente"],
  cancel: ["Cancelar", "Cancel", "Cancelar"],
  loading: [
    "Comprobando tu cuenta…",
    "Checking your account…",
    "Verificando sua conta…",
  ],
  account: [
    "%{account} · %{workspace}",
    "%{account} · %{workspace}",
    "%{account} · %{workspace}",
  ],
  invalid: [
    "Introduce un enlace completo que empiece por https:// o http://.",
    "Enter a complete link starting with https:// or http://.",
    "Insira um link completo começando com https:// ou http://.",
  ],
  empty: [
    "Pega un enlace o usa Compartir → Savia desde otra aplicación.",
    "Paste a link or use Share → Savia from another app.",
    "Cole um link ou use Compartilhar → Savia em outro aplicativo.",
  ],
  failed: [
    "No pudimos confirmar el guardado. Reintenta con los mismos datos; no se creará una copia adicional.",
    "We could not confirm the save. Retry with the same details; no extra copy will be created.",
    "Não foi possível confirmar o salvamento. Tente novamente com os mesmos dados; nenhuma cópia extra será criada.",
  ],
  rejected: [
    "No se pudo guardar en ese destino. Revisa el enlace y elige una carpeta donde puedas crear páginas.",
    "Could not save to that destination. Check the link and choose a folder where you can create pages.",
    "Não foi possível salvar nesse destino. Confira o link e escolha uma pasta onde possa criar páginas.",
  ],
  signIn: [
    "Iniciar sesión para continuar",
    "Sign in to continue",
    "Entrar para continuar",
  ],
  expired: [
    "Tu sesión terminó. Inicia sesión para continuar con este enlace.",
    "Your session ended. Sign in to continue with this link.",
    "Sua sessão terminou. Entre para continuar com este link.",
  ],
  foldersFailed: [
    "No se pudieron cargar las carpetas. Puedes guardar en Guardados o volver a cargarlas.",
    "Folders could not be loaded. You can save to Saved links or reload them.",
    "Não foi possível carregar as pastas. Você pode salvar em Salvos ou recarregá-las.",
  ],
  reload: ["Volver a cargar", "Reload", "Recarregar"],
  accountFailed: [
    "No se pudo comprobar tu cuenta. Vuelve a cargar antes de guardar.",
    "Your account could not be checked. Reload before saving.",
    "Não foi possível verificar sua conta. Recarregue antes de salvar.",
  ],
  offline: [
    "Necesitas conexión para guardar. Mantén esta pantalla abierta y reintenta cuando vuelva la conexión.",
    "You need a connection to save. Keep this screen open and retry when you are back online.",
    "Você precisa de conexão para salvar. Mantenha esta tela aberta e tente novamente quando voltar a ficar online.",
  ],
  storage: [
    "El navegador no conserva este borrador al recargar. Copia el enlace, título y nota antes de salir o iniciar sesión; también tendrás que elegir la carpeta de nuevo.",
    "This browser cannot keep this draft through a reload. Copy the link, title and note before leaving or signing in; you will also need to choose the folder again.",
    "Este navegador não mantém o rascunho ao recarregar. Copie o link, título e nota antes de sair ou entrar; você também precisará escolher a pasta novamente.",
  ],
  sessionChanged: [
    "La cuenta cambió. Vuelve a compartir el enlace para guardarlo con la cuenta actual.",
    "The account changed. Share the link again to save it with the current account.",
    "A conta mudou. Compartilhe o link novamente para salvá-lo com a conta atual.",
  ],
} as const satisfies MessageCatalog;
