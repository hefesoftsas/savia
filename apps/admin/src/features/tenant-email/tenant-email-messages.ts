import type { MessageCatalog } from "@/i18n/core";

export const tenantEmailMessages = {
  "Tenant email delivery": [
    "Correo del tenant",
    "Tenant email",
    "E-mail do tenant",
  ],
  "Configure the SMTP server used for account messages such as password resets.":
    [
      "Configura el servidor SMTP para mensajes de cuenta, como los restablecimientos de contraseña.",
      "Configure the SMTP server used for account messages such as password resets.",
      "Configure o servidor SMTP usado para mensagens da conta, como redefinições de senha.",
    ],
  "SMTP host": ["Servidor SMTP", "SMTP host", "Servidor SMTP"],
  Port: ["Puerto", "Port", "Porta"],
  Security: ["Seguridad", "Security", "Segurança"],
  TLS: ["TLS", "TLS", "TLS"],
  STARTTLS: ["STARTTLS", "STARTTLS", "STARTTLS"],
  Username: ["Usuario", "Username", "Usuário"],
  Password: ["Contraseña", "Password", "Senha"],
  "Sender email": ["Correo remitente", "Sender email", "E-mail do remetente"],
  "Password is saved securely. Leave blank to keep it.": [
    "La contraseña se guarda de forma segura. Déjala vacía para conservarla.",
    "Password is saved securely. Leave blank to keep it.",
    "A senha é armazenada com segurança. Deixe em branco para mantê-la.",
  ],
  "Save email settings": [
    "Guardar configuración de correo",
    "Save email settings",
    "Salvar configuração de e-mail",
  ],
  "Send test email": [
    "Enviar correo de prueba",
    "Send test email",
    "Enviar e-mail de teste",
  ],
  "Remove email settings": [
    "Eliminar configuración de correo",
    "Remove email settings",
    "Remover configuração de e-mail",
  ],
  "Email settings saved.": [
    "Se guardó la configuración de correo.",
    "Email settings saved.",
    "Configuração de e-mail salva.",
  ],
  "Test email sent to your account email.": [
    "Se envió el correo de prueba a tu cuenta.",
    "Test email sent to your account email.",
    "E-mail de teste enviado para o e-mail da sua conta.",
  ],
  "Email settings removed.": [
    "Se eliminó la configuración de correo.",
    "Email settings removed.",
    "Configuração de e-mail removida.",
  ],
  "Email settings could not be loaded. Retry the request.": [
    "No se pudo cargar la configuración. Vuelve a intentarlo.",
    "Email settings could not be loaded. Retry the request.",
    "Não foi possível carregar a configuração. Tente novamente.",
  ],
  "Email settings could not be saved. Check the server details and retry.": [
    "No se pudo guardar la configuración. Revisa los datos del servidor e inténtalo de nuevo.",
    "Email settings could not be saved. Check the server details and retry.",
    "Não foi possível salvar a configuração. Confira os dados do servidor e tente novamente.",
  ],
  "No email settings are configured for this tenant.": [
    "Este tenant no tiene correo configurado.",
    "No email settings are configured for this tenant.",
    "Este tenant não tem e-mail configurado.",
  ],
  Configured: ["Configurado", "Configured", "Configurado"],
  "Loading email settings…": [
    "Cargando configuración de correo…",
    "Loading email settings…",
    "Carregando configuração de e-mail…",
  ],
  "Test email could not be sent. Check the saved server details and retry.": [
    "No se pudo enviar el correo de prueba. Revisa la configuración guardada del servidor e inténtalo de nuevo.",
    "Test email could not be sent. Check the saved server details and retry.",
    "Não foi possível enviar o e-mail de teste. Confira a configuração salva do servidor e tente novamente.",
  ],
  "Email settings could not be removed. Retry the request.": [
    "No se pudo eliminar la configuración de correo. Vuelve a intentarlo.",
    "Email settings could not be removed. Retry the request.",
    "Não foi possível remover a configuração de e-mail. Tente novamente.",
  ],
  Retry: ["Reintentar", "Retry", "Tentar novamente"],
} satisfies MessageCatalog;
