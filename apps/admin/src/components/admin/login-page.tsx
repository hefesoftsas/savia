import { useEffect, useRef } from "react";
import { useAuthProvider, useNotify, useTranslate } from "ra-core";
import { LoaderCircle } from "lucide-react";
import { Notification } from "@/components/admin/notification";

/**
 * Login page displayed when authentication is enabled and the user is not authenticated.
 *
 * Automatically shown when an unauthenticated user tries to access a protected route.
 * Starts login via authProvider.login() immediately and displays errors as notifications.
 *
 * @see {@link https://marmelab.com/shadcn-admin-kit/docs/loginpage LoginPage documentation}
 * @see {@link https://marmelab.com/shadcn-admin-kit/docs/security Security documentation}
 */
export const LoginPage = (_props: { redirectTo?: string }) => {
  const authProvider = useAuthProvider();
  const notify = useNotify();
  const translate = useTranslate();
  const loginStarted = useRef(false);

  useEffect(() => {
    if (!authProvider || loginStarted.current) return;
    loginStarted.current = true;
    void authProvider.login({}).catch((error) => {
      notify(
        typeof error === "string"
          ? error
          : typeof error === "undefined" || !error.message
            ? "ra.auth.sign_in_error"
            : error.message,
        {
          type: "error",
          messageArgs: {
            _:
              typeof error === "string"
                ? error
                : error && error.message
                  ? error.message
                  : undefined,
          },
        },
      );
    });
  }, [authProvider, notify]);

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-3 bg-secondary p-6 text-foreground">
      <div className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
        <LoaderCircle className="size-5 animate-spin" />
      </div>
      <p className="text-sm font-medium text-muted-foreground">
        {translate("savia.auth.signingIn", {
          _: "Iniciando sesión con Savia…",
        })}
      </p>
      <Notification />
    </main>
  );
};
