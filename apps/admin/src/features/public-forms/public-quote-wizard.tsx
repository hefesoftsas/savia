import type { PublicFormDefinition } from "./public-form-page";

export type PublicQuoteFormProps = {
  definition: PublicFormDefinition;
  endpoint: string;
};

/** Minimal router target; full plugin-shaped wizard lands in Task 5. */
export function PublicQuoteForm({ definition }: PublicQuoteFormProps) {
  const products =
    definition.presentation?.renderer === "insurance-quote-wizard"
      ? definition.presentation.products
      : [];
  return (
    <section aria-label="Cotizador por pasos">
      <p>SEGUROS · AUTOS LIVIANOS</p>
      <h1>Cotizador por pasos</h1>
      <p>
        {products.length} producto{products.length === 1 ? "" : "s"}
      </p>
    </section>
  );
}
