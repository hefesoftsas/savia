import type { MessageCatalog } from "@/i18n/core";

export const tenantPagesSearchMessages = {
  "Page search": ["Búsqueda de páginas", "Page search", "Busca de páginas"],
  "Search suggestions": [
    "Sugerencias de búsqueda",
    "Search suggestions",
    "Sugestões de busca",
  ],
  "Showing page suggestions": [
    "Mostrando %{count} sugerencias",
    "Showing %{count} suggestions",
    "Mostrando %{count} sugestões",
  ],
  "No page search matches": [
    "No hay páginas que coincidan.",
    "No matching pages.",
    "Nenhuma página correspondente.",
  ],
  "Page search failed": [
    "No se pudo completar la búsqueda. Inténtalo de nuevo.",
    "Page search could not be completed. Try again.",
    "Não foi possível concluir a busca. Tente novamente.",
  ],
  "Semantic search fallback": [
    "Se muestran coincidencias por título y contenido.",
    "Showing title and content matches.",
    "Mostrando correspondências por título e conteúdo.",
  ],
  "Search status unavailable": [
    "No se pudo cargar el estado del índice; la búsqueda por texto sigue disponible.",
    "Index status could not be loaded; text search is still available.",
    "Não foi possível carregar o estado do índice; a busca por texto continua disponível.",
  ],
  "Page search settings description": [
    "Configura la búsqueda semántica de páginas de este tenant.",
    "Configure semantic search for this tenant’s pages.",
    "Configure a busca semântica das páginas deste tenant.",
  ],
  "Loading page search settings": [
    "Cargando la configuración de búsqueda de páginas…",
    "Loading page search settings…",
    "Carregando as configurações de busca de páginas…",
  ],
  "Grant page search": [
    "Permitir búsqueda semántica de páginas",
    "Grant semantic page search",
    "Permitir busca semântica de páginas",
  ],
  "Enable page search": [
    "Activar búsqueda semántica de páginas",
    "Enable semantic page search",
    "Ativar busca semântica de páginas",
  ],
  "Page search settings saved": [
    "Configuración guardada.",
    "Settings saved.",
    "Configuração salva.",
  ],
  "Page search settings load failed": [
    "No se pudo cargar la configuración de búsqueda de páginas.",
    "Page search settings could not be loaded.",
    "Não foi possível carregar as configurações de busca de páginas.",
  ],
  "Page search settings save failed": [
    "No se pudo guardar la configuración de búsqueda de páginas.",
    "Page search settings could not be saved.",
    "Não foi possível salvar as configurações de busca de páginas.",
  ],
  "Cloudflare search unavailable": [
    "La búsqueda semántica no está disponible en este momento.",
    "Semantic search is unavailable right now.",
    "A busca semântica não está disponível no momento.",
  ],
  "Pages sent for indexing": [
    "%{indexed} de %{total} páginas enviadas a indexación",
    "%{indexed} of %{total} pages sent for indexing",
    "%{indexed} de %{total} páginas enviadas para indexação",
  ],
  "Pages are indexed automatically": [
    "Las páginas antiguas se ponen al día al abrir Páginas. Las páginas nuevas, guardadas o restauradas se envían a indexar en segundo plano. Las importaciones envían hasta cinco páginas; las demás se ponen al día la próxima vez que abras Páginas. Puede tardar unos segundos en aparecer en la búsqueda.",
    "Older pages catch up when you open Pages. New, saved, and restored pages are submitted for background indexing. Imports submit up to five pages; the rest catch up the next time you open Pages. Results may take a few seconds to appear.",
    "Páginas antigas são atualizadas ao abrir Páginas. Páginas novas, salvas ou restauradas são enviadas para indexação em segundo plano. As importações enviam até cinco páginas; as demais são atualizadas na próxima vez que você abrir Páginas. Os resultados podem levar alguns segundos para aparecer.",
  ],
  "Indexing pages": [
    "Indexando páginas: %{done} de %{total}",
    "Indexing pages: %{done} of %{total}",
    "Indexando páginas: %{done} de %{total}",
  ],
  "Indexing paused": [
    "Puesta al día pausada: %{done} de %{total}",
    "Catch-up paused: %{done} of %{total}",
    "Atualização pausada: %{done} de %{total}",
  ],
  "Waiting for page indexing": [
    "Otra solicitud está indexando estas páginas. Comprobaremos el estado de nuevo en unos segundos.",
    "Another request is indexing these pages. Checking again in a few seconds.",
    "Outra solicitação está indexando estas páginas. Vamos verificar novamente em alguns segundos.",
  ],
  "Semantic search results": [
    "Resultados de búsqueda semántica",
    "Semantic search results",
    "Resultados da busca semântica",
  ],
  "Semantic page search failed": [
    "No se pudo completar la búsqueda semántica. Inténtalo de nuevo.",
    "Semantic search could not be completed. Try again.",
    "Não foi possível concluir a busca semântica. Tente novamente.",
  ],
  "Page indexing failed": [
    "No se pudo indexar una página. El índice puede actualizarse de nuevo.",
    "A page could not be indexed. You can update the index again.",
    "Não foi possível indexar uma página. Você pode atualizar o índice novamente.",
  ],
  "Pause indexing": [
    "Pausar puesta al día",
    "Pause catch-up",
    "Pausar atualização",
  ],
  "Resume indexing": [
    "Reanudar puesta al día",
    "Resume catch-up",
    "Retomar atualização",
  ],
  "Retry indexing": [
    "Reintentar indexación",
    "Retry indexing",
    "Tentar indexar novamente",
  ],
  "Searching pages": ["Buscando…", "Searching…", "Buscando…"],
  Retry: ["Reintentar", "Retry", "Tentar novamente"],
} satisfies MessageCatalog;
