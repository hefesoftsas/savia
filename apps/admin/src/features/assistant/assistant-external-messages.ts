import type { MessageCatalog } from "@/i18n/core";

export const assistantExternalMessages = {
  "General assistant": [
    "Asistente general",
    "General assistant",
    "Assistente geral",
  ],
  "Connected assistant": [
    "Asistente conectado",
    "Connected assistant",
    "Assistente conectado",
  ],
  partial: ["parcial", "partial", "parcial"],
  "Loading conversation…": [
    "Cargando conversación…",
    "Loading conversation…",
    "Carregando conversa…",
  ],
  "Ask a question about this workspace item.": [
    "Haz una pregunta sobre este elemento del espacio de trabajo.",
    "Ask a question about this workspace item.",
    "Faça uma pergunta sobre este item do espaço de trabalho.",
  ],
  "The available sources do not support a complete answer.": [
    "Las fuentes disponibles no permiten una respuesta completa.",
    "The available sources do not support a complete answer.",
    "As fontes disponíveis não permitem uma resposta completa.",
  ],
  "This answer uses an earlier source version.": [
    "Esta respuesta usa una versión anterior de las fuentes.",
    "This answer uses an earlier source version.",
    "Esta resposta usa uma versão anterior das fontes.",
  ],
  "Sources (%{count})": [
    "Fuentes (%{count})",
    "Sources (%{count})",
    "Fontes (%{count})",
  ],
  "Preparing a response…": [
    "Preparando una respuesta…",
    "Preparing a response…",
    "Preparando uma resposta…",
  ],
  "Could not load this conversation.": [
    "No se pudo cargar esta conversación.",
    "Could not load this conversation.",
    "Não foi possível carregar esta conversa.",
  ],
  "Could not update the response.": [
    "No se pudo actualizar la respuesta.",
    "Could not update the response.",
    "Não foi possível atualizar a resposta.",
  ],
  "Could not send this message.": [
    "No se pudo enviar este mensaje.",
    "Could not send this message.",
    "Não foi possível enviar esta mensagem.",
  ],
  "Check status": ["Consultar estado", "Check status", "Verificar status"],
  Retry: ["Reintentar", "Retry", "Tentar novamente"],
  "The response is taking longer than expected. Check its status to continue.":
    [
      "La respuesta está tardando más de lo esperado. Consulta su estado para continuar.",
      "The response is taking longer than expected. Check its status to continue.",
      "A resposta está demorando mais do que o esperado. Verifique o status para continuar.",
    ],
  Message: ["Mensaje", "Message", "Mensagem"],
  "Write your question…": [
    "Escribe tu pregunta…",
    "Write your question…",
    "Escreva sua pergunta…",
  ],
  "Shift+Enter for a new line": [
    "Mayús+Intro para una nueva línea",
    "Shift+Enter for a new line",
    "Shift+Enter para uma nova linha",
  ],
  Send: ["Enviar", "Send", "Enviar"],
} as const satisfies MessageCatalog;
