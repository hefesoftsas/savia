import { ApiReferenceReact } from "@scalar/api-reference-react";

export function SaviaRequestDocs() {
  return (
    <section className="mx-auto min-h-0 w-full max-w-screen-2xl py-2">
      <ApiReferenceReact
        configuration={{
          url: "/v1/savia-request/api/openapi.json",
          hideClientButton: true,
          theme: "purple",
        }}
      />
    </section>
  );
}
