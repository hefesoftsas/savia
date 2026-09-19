import { lazy, Suspense } from "react";

const PrivateApp = lazy(async () => {
  const [{ App }, { applyCachedAppearance }, { registerPwaServiceWorker }] =
    await Promise.all([
      import("./app"),
      import("./components/admin/appearance-cache"),
      import("./pwa/register-service-worker"),
    ]);
  applyCachedAppearance();
  registerPwaServiceWorker();
  return { default: App };
});
const PublicForm = lazy(async () => {
  const { PublicFormPage } =
    await import("./features/public-forms/public-form-page");
  return { default: PublicFormPage };
});
/** Public visitors never initialize authenticated services or the admin replica. */
export function ApplicationRoot({
  pathname = window.location.pathname,
}: {
  pathname?: string;
}) {
  const publicPath =
    pathname === "/public/forms" || pathname.startsWith("/public/forms/");
  const match = /^\/public\/forms\/([A-Za-z0-9_-]{20,128})\/?$/.exec(pathname);
  return (
    <Suspense
      fallback={
        <main className="p-6" role="status">
          Cargando…
        </main>
      }
    >
      {publicPath ? (
        match ? (
          <PublicForm token={match[1]} />
        ) : (
          <main className="p-6" role="alert">
            El enlace público no es válido.
          </main>
        )
      ) : (
        <PrivateApp />
      )}
    </Suspense>
  );
}
