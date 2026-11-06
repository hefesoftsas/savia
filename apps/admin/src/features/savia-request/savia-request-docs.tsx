import { ApiReferenceReact } from "@scalar/api-reference-react";
import { useSaviaRequestWorkspace } from "./savia-request-provider";

const openApiRoot = "/v1/savia-request/api/openapi.json";

export function SaviaRequestDocs() {
  const { scope } = useSaviaRequestWorkspace();
  // The reference content (flows, inputs, examples) resolves in the caller's
  // scope. Interactive try-it posts without tenant context, so it keeps the
  // platform boundary: tenant viewers get 403 there and execute from the
  // workspace instead.
  const url = scope
    ? `${openApiRoot}?tenant=${encodeURIComponent(scope)}`
    : openApiRoot;
  return (
    <section className="mx-auto min-h-0 w-full max-w-screen-2xl py-2">
      <ApiReferenceReact
        key={url}
        configuration={{
          url,
          hideClientButton: true,
          theme: "purple",
        }}
      />
    </section>
  );
}
