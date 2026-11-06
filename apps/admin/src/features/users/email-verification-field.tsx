import { BooleanInput } from "@/components/admin";
import { useMessages } from "@/i18n/core";

const messages = {
  "Email verified": [
    "Correo verificado",
    "Email verified",
    "E-mail verificado",
  ],
  Override: [
    "Activar omite el enlace de verificación. Úsalo solo si ya comprobaste que la persona es titular del correo.",
    "Enabling this skips the verification link. Use it only after confirming that the person owns the email address.",
    "Ativar dispensa o link de verificação. Use apenas após confirmar que a pessoa é titular do e-mail.",
  ],
  Pending: [
    "Pendiente de verificación",
    "Pending verification",
    "Verificação pendente",
  ],
} as const;

export function EmailVerificationField({
  source = "emailVerified",
}: {
  source?: string;
}) {
  const t = useMessages(messages);
  return (
    <BooleanInput
      source={source}
      label={t("Email verified")}
      helperText={t("Override")}
      className="md:col-span-2"
    />
  );
}

export function EmailVerificationStatus({ verified }: { verified?: boolean }) {
  const t = useMessages(messages);
  return <span>{verified ? t("Email verified") : t("Pending")}</span>;
}
