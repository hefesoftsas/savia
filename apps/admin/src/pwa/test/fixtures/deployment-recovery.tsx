import { lazy, Suspense, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  DeploymentBoundary,
  DeploymentUpdateNotice,
} from "../../deployment-recovery-ui";
import "@/styles/globals.css";
const retiredModule = "/assets/retired-verification-module.js";
const MissingModule = lazy(() => import(/* @vite-ignore */ retiredModule));
function Fixture() {
  const [load, setLoad] = useState(false);
  return (
    <>
      <DeploymentUpdateNotice />
      <DeploymentBoundary>
        {load ? (
          <Suspense fallback={<p>Cargando módulo…</p>}>
            <MissingModule />
          </Suspense>
        ) : (
          <main className="mx-auto grid max-w-lg gap-4 p-6">
            <h1 className="text-2xl font-semibold">
              Verificación de actualización
            </h1>
            <p>
              Prueba local con un módulo inexistente. No usa registros,
              credenciales ni datos del usuario.
            </p>
            <label className="grid gap-2">
              Borrador sin guardar
              <input className="border p-2" defaultValue="Ejemplo temporal" />
            </label>
            <button
              className="rounded-md bg-primary p-3 text-primary-foreground"
              onClick={() => setLoad(true)}
            >
              Simular módulo retirado
            </button>
          </main>
        )}
      </DeploymentBoundary>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
