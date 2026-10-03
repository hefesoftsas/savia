import type { MessageCatalog } from "@/i18n/core";

export const myDayStateMessages = {
  "Email sent.": ["Correo enviado.", "Email sent.", "E-mail enviado."],
  "Saved widgets could not be read. Starting over.": [
    "Tus widgets guardados no se pudieron leer. Empezamos de cero.",
    "Your saved widgets could not be read. Starting over.",
    "Não foi possível ler seus widgets salvos. Vamos começar de novo.",
  ],
  "Could not load widgets. Try again.": [
    "No pudimos cargar tus widgets. Reintenta.",
    "Could not load your widgets. Try again.",
    "Não foi possível carregar seus widgets. Tente novamente.",
  ],
  "Could not save widgets. Try again.": [
    "No pudimos guardar tus widgets. Reintenta.",
    "Could not save your widgets. Try again.",
    "Não foi possível salvar seus widgets. Tente novamente.",
  ],
  "Widget added to My Day.": [
    "Widget agregado a Mi día.",
    "Widget added to My Day.",
    "Widget adicionado ao Meu Dia.",
  ],
  "Widget removed.": [
    "Widget eliminado.",
    "Widget removed.",
    "Widget removido.",
  ],
  "No pudimos cargar %{provider}. Actualiza o revisa la conexión.": [
    "No pudimos cargar %{provider}. Actualiza o revisa la conexión.",
    "Could not load %{provider}. Refresh or check the connection.",
    "Não foi possível carregar %{provider}. Atualize ou verifique a conexão.",
  ],
  "Could not check your mail connections. Try again.": [
    "No pudimos comprobar tus conexiones de correo. Reintenta.",
    "Could not check your mail connections. Try again.",
    "Não foi possível verificar suas conexões de e-mail. Tente novamente.",
  ],
  "Could not load more mail from %{provider}. Try again.": [
    "No pudimos cargar más correos de %{provider}. Reintenta.",
    "Could not load more mail from %{provider}. Try again.",
    "Não foi possível carregar mais e-mails de %{provider}. Tente novamente.",
  ],
} as const satisfies MessageCatalog;
