import * as React from "react";
import { createRoot } from "react-dom/client";
import { transform } from "sucrase";

const scope = window as any;
function failure(error: unknown) {
  const message = document.createElement("pre");
  message.setAttribute("role", "alert");
  message.style.cssText = "white-space:pre-wrap;color:#a00020;padding:16px";
  message.textContent = "No se pudo renderizar el componente: " + String(error);
  document.body.replaceChildren(message);
}
window.addEventListener("error", (event) => failure(event.message));
scope.React = React;
scope.exports = {};
scope.require = (name: string) => {
  if (name === "react") return React;
  throw new Error(
    "Importación no disponible: " +
      name +
      ". React está disponible sin importar librerías externas.",
  );
};
try {
  const compiled = transform(scope.saviaReactSource, {
    transforms: ["jsx", "typescript", "imports"],
    jsxRuntime: "classic",
    production: true,
  });
  const root = document.createElement("div");
  root.id = "react-results-root";
  document.body.append(root);
  scope.mountResults = () => {
    if (!scope.exports.default)
      throw new Error("Exporta el componente con export default.");
    createRoot(root, { onUncaughtError: failure }).render(
      React.createElement(scope.exports.default, scope.savia),
    );
  };
  const script = document.createElement("script");
  script.textContent = compiled.code + "\nwindow.mountResults();";
  document.body.append(script);
} catch (error) {
  failure(error);
}

