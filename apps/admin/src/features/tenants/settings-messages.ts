import type { MessageCatalog } from "@/i18n/core";

export const tenantSettingsMessages = {
  "Tenant settings": [
    "Configuración del tenant",
    "Tenant settings",
    "Configurações do tenant",
  ],
  General: ["General", "General", "Geral"],
  Access: ["Acceso", "Access", "Acesso"],
  Configuration: ["Configuración", "Configuration", "Configuração"],
  "API keys": ["Claves API", "API keys", "Chaves API"],
  "Manage access links and sign-in providers.": [
    "Consulta el enlace de la organización y configura cómo inicia sesión tu equipo.",
    "Review the organization link and configure how your team signs in.",
    "Consulte o link da organização e configure como sua equipe faz login.",
  ],
  "Configure the tools available to this tenant.": [
    "Configura las herramientas disponibles para esta organización. Cada sección guarda sus cambios por separado.",
    "Configure the tools available to this organization. Each section saves its changes separately.",
    "Configure as ferramentas disponíveis para esta organização. Cada seção salva suas alterações separadamente.",
  ],
  "Delete tenant and all its data": [
    "Eliminar tenant y todos sus datos",
    "Delete tenant and all its data",
    "Excluir tenant e todos os seus dados",
  ],
  "Permanently removes this commercial tenant and its associated data. This action cannot be undone.":
    [
      "Elimina permanentemente este tenant comercial y sus datos asociados. Esta acción no se puede deshacer.",
      "Permanently removes this commercial tenant and its associated data. This action cannot be undone.",
      "Remove permanentemente este tenant comercial e os dados associados. Esta ação não pode ser desfeita.",
    ],
  "Type %{name} to confirm": [
    "Escribe %{name} para confirmar",
    "Type %{name} to confirm",
    "Digite %{name} para confirmar",
  ],
  "Delete permanently": [
    "Eliminar definitivamente",
    "Delete permanently",
    "Excluir permanentemente",
  ],
  "The tenant could not be fully deleted. Retry the deletion or contact a platform administrator.":
    [
      "No se pudo completar la eliminación del tenant. Inténtalo de nuevo o contacta a un administrador de plataforma.",
      "The tenant could not be fully deleted. Retry the deletion or contact a platform administrator.",
      "Não foi possível concluir a exclusão do tenant. Tente novamente ou entre em contato com um administrador da plataforma.",
    ],
  "The tenant name changed or did not match. Refresh the tenant and confirm using its current name.":
    [
      "El nombre del tenant cambió o no coincide. Actualiza el tenant y confirma con su nombre actual.",
      "The tenant name changed or did not match. Refresh the tenant and confirm using its current name.",
      "O nome do tenant mudou ou não corresponde. Atualize o tenant e confirme usando o nome atual.",
    ],
  "Some cleanup services are unavailable. Refresh the tenant and retry the deletion.":
    [
      "Algunos servicios de limpieza no están disponibles. Actualiza el tenant e intenta eliminarlo de nuevo.",
      "Some cleanup services are unavailable. Refresh the tenant and retry the deletion.",
      "Alguns serviços de limpeza estão indisponíveis. Atualize o tenant e tente excluí-lo novamente.",
    ],
  "Deleting…": ["Eliminando…", "Deleting…", "Excluindo…"],
  "Could not delete the tenant. Retry or contact a platform administrator.": [
    "No se pudo eliminar el tenant. Inténtalo de nuevo o contacta a un administrador de plataforma.",
    "Could not delete the tenant. Retry or contact a platform administrator.",
    "Não foi possível excluir o tenant. Tente novamente ou entre em contato com um administrador da plataforma.",
  ],
  "This tenant no longer exists. Return to the tenant list and refresh it.": [
    "Este tenant ya no existe. Vuelve al listado de tenants y actualízalo.",
    "This tenant no longer exists. Return to the tenant list and refresh it.",
    "Este tenant não existe mais. Volte à lista de tenants e atualize-a.",
  ],
} satisfies MessageCatalog;
