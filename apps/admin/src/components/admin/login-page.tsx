import { useEffect, useRef } from "react";
import { useAuthProvider, useNotify, useTranslate } from "ra-core";
import { PwaSplash } from "@/pwa/pwa-splash";
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
    <>
      <PwaSplash
        recoveryHref="/api/auth/admin/authorize"
        message={translate("savia.auth.signingIn", {
          _: "Iniciando sesión con Savia…",
        })}
      />
      <Notification />
    </>
  );
};
