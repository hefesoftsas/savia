import type { MessageCatalog } from "../core";

export const backgroundRefreshMessages = {
  Updating: ["Actualizando", "Updating", "Atualizando"],
  "Refresh failed: %{error}": [
    "Falló la actualización: %{error}",
    "Refresh failed: %{error}",
    "Falha ao atualizar: %{error}",
  ],
  Retry: ["Reintentar", "Retry", "Tentar novamente"],
} as const satisfies MessageCatalog;
