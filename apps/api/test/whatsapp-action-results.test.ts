import { expect, it } from "vitest";
import { actionResultText } from "../src/whatsapp/action-results";

it("distinguishes undispatched products from uncertain provider responses", () => {
  const text = actionResultText("Alice", "quote-auto", {
    state: "completed",
    result: {
      reference: "COT-budget",
      pricedOffers: 1,
      failedOffers: 0,
      uncertainOffers: 0,
      undispatchedOffers: 2,
      lowestPriceOffers: [{ product: "Received product", premium: 1000000 }],
    },
  });
  expect(text).toContain("Resultados parciales de COT-budget");
  expect(text).toContain("Productos sin consultar: 2");
  expect(text).toContain("Received product: $1.000.000");
  expect(text).not.toContain("Sin resultado verificado:");
});

it("directs a quote with no priced offers to the configured human contact", () => {
  const text = actionResultText(
    "Alice",
    "quote-auto",
    {
      state: "completed",
      result: {
        reference: "COT-test",
        pricedOffers: 0,
        failedOffers: 1,
        lowestPriceOffers: [],
      },
    },
    "https://support.example.test/help",
  );
  expect(text).toContain("No recibí ofertas con precio");
  expect(text).toContain("https://support.example.test/help");
});

it.each(["failed", "uncertain"] as const)(
  "directs %s actions to configured human support without claiming completion",
  (state) => {
    const text = actionResultText(
      "Alice",
      "quote-auto",
      { state, message: "No pude verificar el resultado." },
      "https://support.example.test/help",
    );
    expect(text).toContain("No pude verificar el resultado.");
    expect(text).toContain(
      "contactar directamente a un asesor en https://support.example.test/help",
    );
    expect(text).not.toContain("Solicitud completada");
  },
);
it("summarizes actual saved offers and labels the originating employee", () => {
  const text = actionResultText("Alice", "quote-auto", {
    state: "completed",
    result: {
      reference: "COT-test",
      pricedOffers: 1,
      failedOffers: 2,
      lowestPriceOffers: [{ product: "Product", premium: 1500000 }],
      recommendation: "Faltan coberturas.",
    },
  });
  expect(text).toContain("Alice · Asistente virtual");
  expect(text).toContain("COT-test");
  expect(text).toContain("1.500.000");
  expect(text).toContain("2");
  expect(text).not.toContain("http");
});

it("shows saved priced offers even when another insurer outcome is uncertain", () => {
  const text = actionResultText(
    "Alice",
    "quote-auto",
    {
      state: "uncertain",
      message:
        "Una solicitud necesita revisión; no la repitas automáticamente.",
      result: {
        reference: "COT-partial",
        pricedOffers: 1,
        failedOffers: 1,
        uncertainOffers: 2,
        unpricedOffers: 3,
        lowestPriceOffers: [{ product: "Verified product", premium: 1500000 }],
        recommendation: "Faltan coberturas y deducibles.",
      },
    },
    "https://support.example.test/help",
  );
  expect(text).toContain("Resultados parciales de COT-partial");
  expect(text).toContain("Verified product: $1.500.000");
  expect(text).toContain("Ofertas con precio: 1");
  expect(text).toContain("Respuestas fallidas: 1");
  expect(text).toContain("Sin resultado verificado: 2");
  expect(text).toContain("Respuestas sin precio: 3");
  expect(text).toContain("no la repitas automáticamente");
  expect(text).not.toContain("https://support.example.test/help");
  expect(text).not.toContain("contactar directamente a un asesor");
  expect(text).not.toContain("Solicitud completada");
});

it("shows incomplete quote states and relevant persistence warnings without exposing internal links", () => {
  const text = actionResultText("Alice", "quote-auto", {
    state: "completed",
    result: {
      reference: "COT-saved",
      pricedOffers: 1,
      failedOffers: 0,
      unpricedOffers: 2,
      lowestPriceOffers: [{ product: "Verified product", premium: 1000000 }],
      persistenceWarnings: [
        "No se pudo actualizar el estado de la cotización guardada.",
      ],
      url: "https://internal.example.test/quotes/private",
    },
  });
  expect(text).toContain("Respuestas sin precio: 2");
  expect(text).toContain("Resultados parciales de COT-saved");
  expect(text).toContain(
    "No se pudo actualizar el estado de la cotización guardada.",
  );
  expect(text).toContain("Puedes preguntarme por esta cotización");
  expect(text).not.toContain("https://internal.example.test");
});

it("appends the actual task menu to a terminal quote failure and keeps it within WhatsApp limits", () => {
  const menu =
    "¿Qué deseas hacer? Escribe menú o inicio para volver aquí.\n\n1. Consultar seguros\n2. Asistencia vial\n\nResponde con el número de la opción.";
  const text = actionResultText(
    "Alice",
    "quote-auto",
    { state: "failed", message: "No fue posible completar la cotización." },
    "",
    menu,
  );
  expect(text).toContain("No fue posible completar la cotización.");
  expect(text).toContain(menu);

  const completedWithMenu = actionResultText(
    "Alice",
    "quote-auto",
    {
      state: "completed",
      result: { reference: "COT-menu", pricedOffers: 1 },
    },
    "",
    menu,
  );
  expect(completedWithMenu).toContain(menu);
  expect(completedWithMenu).not.toContain(
    "Puedes preguntarme por esta cotización",
  );
  expect(completedWithMenu).toContain("empezar una nueva tarea");

  const longMenu = "Menú\n" + "x".repeat(5000);
  const bounded = actionResultText(
    "Alice",
    "quote-auto",
    { state: "completed", result: { reference: "COT-test" } },
    "",
    longMenu,
  );
  expect(bounded.length).toBeLessThanOrEqual(4096);
  expect(bounded).toContain("Menú\n");
});
