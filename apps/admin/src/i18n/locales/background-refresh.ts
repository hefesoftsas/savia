import type { MessageCatalog } from "../core";

export const backgroundRefreshMessages = {
  Updating: ["Actualizando", "Updating", "Atualizando"],
  "Refresh failed: %{error}": [
    "Falló la actualización: %{error}",
    "Refresh failed: %{error}",
    "Falha ao atualizar: %{error}",
  ],
  "Loading workspace": [
    "Cargando organización…",
    "Loading workspace…",
    "Carregando organização…",
  ],
  "Workspace could not be resolved": [
    "No se pudo identificar la organización. Reintenta para continuar.",
    "The workspace could not be identified. Retry to continue.",
    "Não foi possível identificar a organização. Tente novamente para continuar.",
  ],
  Retry: ["Reintentar", "Retry", "Tentar novamente"],
} as const satisfies MessageCatalog;
