import type { MessageCatalog } from "@/i18n/core";

export const tenantSocialMessages = {
  "Google / Microsoft": [
    "Google / Microsoft",
    "Google / Microsoft",
    "Google / Microsoft",
  ],
  "Social sign-in": [
    "Inicio de sesión social",
    "Social sign-in",
    "Entrada com redes sociais",
  ],
  "Let tenant members use Google or Microsoft to sign in.": [
    "Permite que los miembros del tenant inicien sesión con Google o Microsoft.",
    "Let tenant members use Google or Microsoft to sign in.",
    "Permita que os membros do tenant entrem com Google ou Microsoft.",
  ],
  "Provider credentials are configured by your deployment administrator. You can enable a provider when it is available.":
    [
      "El administrador del despliegue configura las credenciales del proveedor. Puedes activarlo cuando esté disponible.",
      "Provider credentials are configured by your deployment administrator. You can enable a provider when it is available.",
      "O administrador da implantação configura as credenciais do provedor. Você pode ativá-lo quando estiver disponível.",
    ],
  "Enable Google sign-in": [
    "Activar inicio de sesión con Google",
    "Enable Google sign-in",
    "Ativar entrada com Google",
  ],
  "Enable Microsoft sign-in": [
    "Activar inicio de sesión con Microsoft",
    "Enable Microsoft sign-in",
    "Ativar entrada com Microsoft",
  ],
  "Google credentials are not available in this deployment.": [
    "Las credenciales de Google no están disponibles en este despliegue.",
    "Google credentials are not available in this deployment.",
    "As credenciais do Google não estão disponíveis nesta implantação.",
  ],
  "Microsoft credentials are not available in this deployment.": [
    "Las credenciales de Microsoft no están disponibles en este despliegue.",
    "Microsoft credentials are not available in this deployment.",
    "As credenciais da Microsoft não estão disponíveis nesta implantação.",
  ],
  "Microsoft Entra tenant ID": [
    "ID del tenant de Microsoft Entra",
    "Microsoft Entra tenant ID",
    "ID do tenant do Microsoft Entra",
  ],
  "Enter the UUID of your Microsoft Entra directory. Personal Microsoft accounts are not supported.":
    [
      "Ingresa el UUID de tu directorio de Microsoft Entra. No se admiten cuentas personales de Microsoft.",
      "Enter the UUID of your Microsoft Entra directory. Personal Microsoft accounts are not supported.",
      "Digite o UUID do diretório do Microsoft Entra. Contas pessoais da Microsoft não são compatíveis.",
    ],
  "Google callback URL": [
    "URL de retorno de Google",
    "Google callback URL",
    "URL de retorno do Google",
  ],
  "Microsoft callback URL": [
    "URL de retorno de Microsoft",
    "Microsoft callback URL",
    "URL de retorno da Microsoft",
  ],
  "Save social sign-in settings": [
    "Guardar configuración de inicio social",
    "Save social sign-in settings",
    "Salvar configuração de entrada social",
  ],
  "Remove social sign-in settings": [
    "Eliminar configuración de inicio social",
    "Remove social sign-in settings",
    "Remover configuração de entrada social",
  ],
  "Social sign-in settings saved.": [
    "Se guardó la configuración de inicio social.",
    "Social sign-in settings saved.",
    "Configuração de entrada social salva.",
  ],
  "Social sign-in settings removed.": [
    "Se eliminó la configuración de inicio social.",
    "Social sign-in settings removed.",
    "Configuração de entrada social removida.",
  ],
  "Social sign-in settings could not be loaded. Retry the request.": [
    "No se pudo cargar la configuración de inicio social. Vuelve a intentarlo.",
    "Social sign-in settings could not be loaded. Retry the request.",
    "Não foi possível carregar a configuração de entrada social. Tente novamente.",
  ],
  "Social sign-in settings could not be saved. Check the Microsoft tenant ID and retry.":
    [
      "No se pudo guardar la configuración. Revisa el ID del tenant de Microsoft e inténtalo de nuevo.",
      "Social sign-in settings could not be saved. Check the Microsoft tenant ID and retry.",
      "Não foi possível salvar a configuração. Confira o ID do tenant da Microsoft e tente novamente.",
    ],
  "Social sign-in settings could not be removed. Retry the request.": [
    "No se pudo eliminar la configuración de inicio social. Vuelve a intentarlo.",
    "Social sign-in settings could not be removed. Retry the request.",
    "Não foi possível remover a configuração de entrada social. Tente novamente.",
  ],
  "Loading social sign-in settings…": [
    "Cargando configuración de inicio social…",
    "Loading social sign-in settings…",
    "Carregando configuração de entrada social…",
  ],
  "No social sign-in providers are enabled for this tenant.": [
    "No hay proveedores de inicio social activados para este tenant.",
    "No social sign-in providers are enabled for this tenant.",
    "Nenhum provedor de entrada social está ativo para este tenant.",
  ],
  Configured: ["Configurado", "Configured", "Configurado"],
  Retry: ["Reintentar", "Retry", "Tentar novamente"],
} satisfies MessageCatalog;
