/** Display captions for request execution states; persisted state values stay unchanged. */
export const integrationMessages = {
  running: ["En proceso", "In progress", "Em andamento"],
  complete: ["Completada", "Completed", "Concluída"],
  failed: ["No se completó", "Not completed", "Não concluído"],
} as const;
