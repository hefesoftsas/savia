import type { MessageCatalog } from "@/i18n/core";

export const selectionAIMessages = {
  "Ask AI": ["Pedir a IA", "Ask AI", "Pedir à IA"],
  Description: [
    "Trabaja con el texto seleccionado y revisa la respuesta antes de aplicarla.",
    "Work with the selected text and review the response before applying it.",
    "Trabalhe com o texto selecionado e revise a resposta antes de aplicá-la.",
  ],
  "Selected text": ["Texto seleccionado", "Selected text", "Texto selecionado"],
  Assistant: ["Asistente", "Assistant", "Assistente"],
  "Connected model": [
    "Modelo conectado (predeterminado)",
    "Connected model (default)",
    "Modelo conectado (padrão)",
  ],
  Instruction: ["Instrucción", "Instruction", "Instrução"],
  Placeholder: [
    "¿Qué quieres hacer con este texto?",
    "What would you like to do with this text?",
    "O que deseja fazer com este texto?",
  ],
  Summarize: ["Resumir", "Summarize", "Resumir"],
  Improve: ["Mejorar redacción", "Improve writing", "Melhorar redação"],
  Translate: ["Traducir", "Translate", "Traduzir"],
  Explain: ["Explicar", "Explain", "Explicar"],
  "Summarize prompt": [
    "Resume el texto seleccionado conservando sus ideas principales.",
    "Summarize the selected text, preserving its main ideas.",
    "Resuma o texto selecionado, preservando suas ideias principais.",
  ],
  "Improve prompt": [
    "Mejora la claridad y la redacción del texto seleccionado conservando su significado y su idioma.",
    "Improve the clarity and writing of the selected text, preserving its meaning and language.",
    "Melhore a clareza e a redação do texto selecionado, preservando seu significado e idioma.",
  ],
  "Translate prompt": [
    "Traduce el texto seleccionado al inglés.",
    "Translate the selected text into Spanish.",
    "Traduza o texto selecionado para inglês.",
  ],
  "Explain prompt": [
    "Explica el texto seleccionado con palabras sencillas.",
    "Explain the selected text in simple terms.",
    "Explique o texto selecionado em termos simples.",
  ],
  Generate: ["Generar", "Generate", "Gerar"],
  Generating: [
    "Generando respuesta…",
    "Generating response…",
    "Gerando resposta…",
  ],
  Cancel: ["Cancelar", "Cancel", "Cancelar"],
  Response: ["Respuesta", "Response", "Resposta"],
  "Replace selection": [
    "Reemplazar selección",
    "Replace selection",
    "Substituir seleção",
  ],
  "Insert below": ["Insertar debajo", "Insert below", "Inserir abaixo"],
  Copy: ["Copiar", "Copy", "Copiar"],
  Copied: ["Copiado", "Copied", "Copiado"],
  "Request failed": [
    "No se pudo generar la respuesta. Revisa la conexión del asistente y vuelve a intentarlo.",
    "Could not generate a response. Check the assistant connection and try again.",
    "Não foi possível gerar a resposta. Verifique a conexão do assistente e tente novamente.",
  ],
  "Employees failed": [
    "No se pudieron cargar los empleados. Puedes usar el modelo conectado o volver a intentar.",
    "Could not load employees. You can use the connected model or retry.",
    "Não foi possível carregar os funcionários. Use o modelo conectado ou tente novamente.",
  ],
  Retry: ["Reintentar", "Retry", "Tentar novamente"],
  "Selection changed": [
    "El texto seleccionado cambió. Cierra el panel y vuelve a seleccionarlo antes de aplicar la respuesta.",
    "The selected text changed. Close the panel and select it again before applying the response.",
    "O texto selecionado mudou. Feche o painel e selecione-o novamente antes de aplicar a resposta.",
  ],
  "Copy failed": [
    "No se pudo copiar. Selecciona la respuesta y cópiala manualmente.",
    "Could not copy. Select the response and copy it manually.",
    "Não foi possível copiar. Selecione a resposta e copie-a manualmente.",
  ],
} satisfies MessageCatalog;
