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
  "Create new users through federated sign-in": [
    "Crear nuevos usuarios mediante login federado",
    "Create new users through federated sign-in",
    "Criar novos usuários com login federado",
  ],
  "When disabled, an administrator must create users before they can sign in. When enabled, anyone with a provider-verified email from an enabled provider can join, subject to this tenant's user limit.":
    [
      "Si está desactivado, un administrador debe crear los usuarios antes de que puedan iniciar sesión. Si está activado, cualquier persona con un correo verificado por un proveedor habilitado puede unirse, sujeto al límite de usuarios de este tenant.",
      "When disabled, an administrator must create users before they can sign in. When enabled, anyone with a provider-verified email from an enabled provider can join, subject to this tenant's user limit.",
      "Quando desativado, um administrador precisa criar os usuários antes que possam entrar. Quando ativado, qualquer pessoa com um email verificado por um provedor ativo pode participar, sujeito ao limite de usuários deste tenant.",
    ],
  "Initial access: Viewer": [
    "Acceso inicial: Viewer",
    "Initial access: Viewer",
    "Acesso inicial: Viewer",
  ],
  "the minimum role; federated sign-in cannot grant administrator access.": [
    "el rol mínimo; el login federado no concede acceso de administrador.",
    "the minimum role; federated sign-in cannot grant administrator access.",
    "o nível mínimo; o login federado não concede acesso de administrador.",
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
  "Allow personal Microsoft accounts": [
    "Permitir cuentas personales de Microsoft",
    "Allow personal Microsoft accounts",
    "Permitir contas pessoais da Microsoft",
  ],
  "When enabled, personal Microsoft accounts can sign in alongside accounts from the configured organization directory.":
    [
      "Al activarlo, las cuentas personales de Microsoft también podrán iniciar sesión junto con las cuentas del directorio organizacional configurado.",
      "When enabled, personal Microsoft accounts can sign in alongside accounts from the configured organization directory.",
      "Quando ativado, contas pessoais da Microsoft também poderão entrar junto com as contas do diretório organizacional configurado.",
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
  "Enter your organization's Microsoft Entra directory UUID. Personal accounts can be enabled separately.":
    [
      "Ingresa el UUID del directorio organizacional de Microsoft Entra. Las cuentas personales se pueden permitir por separado.",
      "Enter your organization's Microsoft Entra directory UUID. Personal accounts can be enabled separately.",
      "Digite o UUID do diretório organizacional do Microsoft Entra. Contas pessoais podem ser permitidas separadamente.",
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
