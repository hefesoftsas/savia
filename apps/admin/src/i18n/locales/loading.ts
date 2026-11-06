import type { MessageCatalog } from "../core";

export const loadingMessages = {
  loadingLong: [
    "La carga está tardando más de lo esperado.",
    "This is taking longer than expected.",
    "O carregamento está demorando mais que o esperado.",
  ],
  loadingHelp: [
    "Puedes volver a intentarlo o iniciar sesión de nuevo.",
    "You can retry or sign in again.",
    "Você pode tentar novamente ou entrar outra vez.",
  ],
  retry: ["Reintentar", "Retry", "Tentar novamente"],
  signInAgain: ["Volver a iniciar sesión", "Sign in again", "Entrar novamente"],
} as const satisfies MessageCatalog;
