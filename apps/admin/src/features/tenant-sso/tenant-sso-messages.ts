import type { MessageCatalog } from "@/i18n/core";

export const tenantSSOMessages = {
  "Tenant SAML SSO": [
    "Inicio de sesión SAML",
    "Tenant SAML SSO",
    "SSO SAML do tenant",
  ],
  "Allow members of this tenant to sign in through your identity provider.": [
    "Permite que los miembros de este tenant inicien sesión con tu proveedor de identidad.",
    "Allow members of this tenant to sign in through your identity provider.",
    "Permita que os membros deste tenant entrem pelo seu provedor de identidade.",
  ],
  "SAML identity provider": [
    "Proveedor de identidad SAML",
    "SAML identity provider",
    "Provedor de identidade SAML",
  ],
  "Provider name": [
    "Nombre del proveedor",
    "Provider name",
    "Nome do provedor",
  ],
  "Email domain": ["Dominio de correo", "Email domain", "Domínio de e-mail"],
  "For example, company.example. The domain must be lowercase.": [
    "Por ejemplo, empresa.example. El dominio debe estar en minúsculas.",
    "For example, company.example. The domain must be lowercase.",
    "Por exemplo, empresa.example. O domínio deve estar em minúsculas.",
  ],
  "Identity provider metadata XML": [
    "XML de metadatos del proveedor",
    "Identity provider metadata XML",
    "XML de metadados do provedor de identidade",
  ],
  "Paste the IdP metadata XML (up to 100 KiB). It contains public endpoints and certificates.":
    [
      "Pega el XML de metadatos públicos del IdP (hasta 100 KiB). Incluye sus endpoints y certificados públicos.",
      "Paste the IdP metadata XML (up to 100 KiB). It contains public endpoints and certificates.",
      "Cole o XML de metadados públicos do IdP (até 100 KiB). Ele inclui os endpoints e certificados públicos.",
    ],
  "Enable SAML sign-in": [
    "Activar inicio de sesión SAML",
    "Enable SAML sign-in",
    "Ativar entrada SAML",
  ],
  "SSO-only sign-in": [
    "Inicio de sesión solo con SSO",
    "SSO-only sign-in",
    "Entrada somente por SSO",
  ],
  "When enabled, tenant members cannot use a password sign-in or password reset. Only active, pre-provisioned users with a verified email can sign in through SAML. Platform administrators keep local recovery access.":
    [
      "Al activarlo, los miembros del tenant no podrán iniciar sesión ni restablecer su contraseña. Solo podrán entrar por SAML los usuarios activos y creados previamente con correo verificado. Los administradores de plataforma conservan el acceso local de recuperación.",
      "When enabled, tenant members cannot use a password sign-in or password reset. Only active, pre-provisioned users with a verified email can sign in through SAML. Platform administrators keep local recovery access.",
      "Quando ativado, os membros do tenant não poderão entrar com senha nem redefini-la. Somente usuários ativos, provisionados previamente e com e-mail verificado poderão entrar pelo SAML. Administradores da plataforma mantêm o acesso local de recuperação.",
    ],
  "Save SSO settings": [
    "Guardar configuración de SSO",
    "Save SSO settings",
    "Salvar configuração de SSO",
  ],
  "Remove SSO settings": [
    "Eliminar configuración de SSO",
    "Remove SSO settings",
    "Remover configuração de SSO",
  ],
  "SSO settings saved.": [
    "Se guardó la configuración de SSO.",
    "SSO settings saved.",
    "Configuração de SSO salva.",
  ],
  "SSO settings removed.": [
    "Se eliminó la configuración de SSO.",
    "SSO settings removed.",
    "Configuração de SSO removida.",
  ],
  "SSO settings could not be loaded. Retry the request.": [
    "No se pudo cargar la configuración de SSO. Vuelve a intentarlo.",
    "SSO settings could not be loaded. Retry the request.",
    "Não foi possível carregar a configuração de SSO. Tente novamente.",
  ],
  "SSO settings could not be saved. Check the provider metadata and retry.": [
    "No se pudo guardar la configuración de SSO. Revisa los metadatos del proveedor e inténtalo de nuevo.",
    "SSO settings could not be saved. Check the provider metadata and retry.",
    "Não foi possível salvar a configuração de SSO. Confira os metadados do provedor e tente novamente.",
  ],
  "SSO settings could not be removed. Retry the request.": [
    "No se pudo eliminar la configuración de SSO. Vuelve a intentarlo.",
    "SSO settings could not be removed. Retry the request.",
    "Não foi possível remover a configuração de SSO. Tente novamente.",
  ],
  "Loading SSO settings…": [
    "Cargando configuración de SSO…",
    "Loading SSO settings…",
    "Carregando configuração de SSO…",
  ],
  "No SAML provider is configured for this tenant.": [
    "Este tenant no tiene un proveedor SAML configurado.",
    "No SAML provider is configured for this tenant.",
    "Este tenant não tem um provedor SAML configurado.",
  ],
  Configured: ["Configurado", "Configured", "Configurado"],
  "Service provider details": [
    "Datos del proveedor de servicio",
    "Service provider details",
    "Detalhes do provedor de serviço",
  ],
  "Service provider entity ID": [
    "ID de entidad del proveedor de servicio",
    "Service provider entity ID",
    "ID de entidade do provedor de serviço",
  ],
  "Assertion consumer URL (ACS)": [
    "URL del consumidor de aserciones (ACS)",
    "Assertion consumer URL (ACS)",
    "URL do consumidor de asserções (ACS)",
  ],
  "Service provider metadata URL": [
    "URL de metadatos del proveedor de servicio",
    "Service provider metadata URL",
    "URL de metadados do provedor de serviço",
  ],
  Retry: ["Reintentar", "Retry", "Tentar novamente"],
} satisfies MessageCatalog;
