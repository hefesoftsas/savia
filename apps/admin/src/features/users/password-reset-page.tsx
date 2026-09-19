import { useState, type FormEvent } from "react";
import { useTranslate } from "ra-core";
import { Building2, CheckCircle2, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function requestUrl(baseUrl: string, path: string): string {
  return new URL(path, `${baseUrl.replace(/\/$/, "")}/`).toString();
}

export function PasswordResetPage({ apiUrl }: { apiUrl: string }) {
  const translate = useTranslate();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [complete, setComplete] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const token = new URLSearchParams(window.location.search).get("token");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token) {
      setError(
        translate("savia.passwordReset.errors.invalidToken", {
          _: "El enlace de restablecimiento no es válido.",
        }),
      );
      return;
    }
    if (password.length < 8) {
      setError(
        translate("savia.passwordReset.errors.minLength", {
          _: "La contraseña debe tener al menos 8 caracteres.",
        }),
      );
      return;
    }
    if (password !== confirmation) {
      setError(
        translate("savia.passwordReset.errors.mismatch", {
          _: "Las contraseñas no coinciden.",
        }),
      );
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(
        requestUrl(apiUrl, "/api/auth/reset-password"),
        {
          method: "POST",
          credentials: "include",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ token, newPassword: password }),
        },
      );
      if (!response.ok) {
        throw new Error(
          translate("savia.passwordReset.errors.failed", {
            _: "El enlace expiró o no fue posible actualizar la contraseña.",
          }),
        );
      }
      setComplete(true);
    } catch (exception) {
      setError(
        exception instanceof Error
          ? exception.message
          : translate("savia.passwordReset.errors.generic", {
              _: "No fue posible actualizar la contraseña.",
            }),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-6 text-foreground">
      <section className="w-full max-w-md rounded-xl border bg-card p-7 shadow-sm">
        <div className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          {complete ? (
            <CheckCircle2 className="size-5" />
          ) : (
            <KeyRound className="size-5" />
          )}
        </div>
        <h1 className="mt-6 text-2xl font-semibold tracking-tight">
          {complete
            ? translate("savia.passwordReset.successTitle", {
                _: "Contraseña actualizada",
              })
            : translate("savia.passwordReset.createPasswordTitle", {
                _: "Crea una contraseña",
              })}
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {complete
            ? translate("savia.passwordReset.successDescription", {
                _: "Ya puedes ingresar a Savia con tu nueva contraseña.",
              })
            : translate("savia.passwordReset.createPasswordDescription", {
                _: "Elige una contraseña segura para terminar de activar tu cuenta.",
              })}
        </p>
        {complete ? (
          <Button
            className="mt-6 w-full"
            onClick={() => window.location.replace(window.location.origin)}
          >
            <Building2 className="size-4" />
            {translate("savia.passwordReset.goToSavia", { _: "Ir a Savia" })}
          </Button>
        ) : (
          <form
            className="mt-6 grid gap-4"
            onSubmit={(event) => void submit(event)}
          >
            <label className="grid gap-2">
              <Label htmlFor="new-password">
                {translate("savia.passwordReset.newPassword", {
                  _: "Nueva contraseña",
                })}
              </Label>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={submitting}
              />
            </label>
            <label className="grid gap-2">
              <Label htmlFor="confirm-password">
                {translate("savia.passwordReset.confirmPassword", {
                  _: "Confirmar contraseña",
                })}
              </Label>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                disabled={submitting}
              />
            </label>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button type="submit" disabled={submitting || !token}>
              {submitting
                ? translate("savia.passwordReset.submitting", {
                    _: "Actualizando…",
                  })
                : translate("savia.passwordReset.submit", {
                    _: "Guardar contraseña",
                  })}
            </Button>
          </form>
        )}
      </section>
    </main>
  );
}
