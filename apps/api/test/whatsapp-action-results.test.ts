import { expect, it } from "vitest";
import { actionResultText } from "../src/whatsapp/action-results";

it("keeps the public quote link and model suggestion visible alongside the task menu", () => {
  const url = "https://savia.test/public/quotes/" + "a".repeat(64);
  const text = actionResultText(
    "Alice",
    "quote-auto",
    {
      state: "completed",
      result: {
        reference: "COT-report",
        pricedOffers: 1,
        publicUrl: url,
        recommendation: "Esta oferta tiene la prima verificada más baja.",
        persistenceWarnings: ["W".repeat(5000)],
      },
    },
    "",
    "Menú: " + "M".repeat(4000),
  );
  expect(text).toContain(url);
  expect(text).toContain("Esta oferta tiene la prima verificada más baja.");
  expect(text).toContain("Menú:");
  expect(text.length).toBeLessThanOrEqual(4096);
});

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
  expect(text).toContain("Resultados parciales de tu cotización");
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
  expect(text).not.toContain("COT-test");
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
  expect(text).toContain("Resultados parciales de tu cotización");
  expect(text).toContain("Verified product: $1.500.000");
  expect(text).toContain("Ofertas con precio: 1");
  expect(text).toContain("Respuestas fallidas: 1");
  expect(text).toContain("Sin resultado verificado: 2");
  expect(text).toContain("Respuestas sin precio: 3");
  expect(text).toContain("no se repetirán automáticamente");
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
  expect(text).toContain("Resultados parciales de tu cotización");
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
    {
      state: "completed",
      result: {
        reference: "COT-test",
        pricedOffers: 1,
        lowestPriceOffers: [
          { product: "Liberty · Integral", premium: 1591272 },
        ],
      },
    },
    "",
    longMenu,
  );
  expect(bounded.length).toBeLessThanOrEqual(4096);
  expect(bounded).toContain("Menú\n");
  expect(bounded).toContain("Liberty · Integral: $1.591.272");
});

it("hides internal action references from quote summaries and uncertain messages", () => {
  const internal = "COT-bb25b9f1-fd88-40d3-bd44-fd6921465d10";
  const text = actionResultText("Alice", "quote-auto", {
    state: "uncertain",
    message: `La cotización ${internal} tiene solicitudes sin resultado verificado.`,
    result: {
      reference: internal,
      publicReference: "COT-20261007-A1B2C3D4",
      pricedOffers: 1,
      uncertainOffers: 1,
      lowestPriceOffers: [{ product: "Liberty · Integral", premium: 1591272 }],
    },
  });
  expect(text).not.toContain(internal);
  expect(text).toContain("COT-20261007-A1B2C3D4");
  expect(text).toContain("Liberty · Integral: $1.591.272");
});

it("summarizes every priced proposal with verified policy details when analysis is unavailable", () => {
  const proposals = ["Basic", "Basic + PT", "Integral", "Full"].map(
    (product, index) => ({
      id: `product-${index}`,
      provider: "Carrier",
      product,
      state: "priced",
      premium: 1000000 + index * 100000,
      currency: "COP",
      facts: [
        {
          label: "Responsabilidad civil",
          value: "$4.400.000.000 COP; deducible: 0%",
          source: "provider",
        },
      ],
    }),
  );
  const text = actionResultText(
    "Alice",
    "quote-auto",
    {
      state: "completed",
      result: {
        reference: "internal",
        pricedOffers: 4,
        proposals,
        lowestPriceOffers: [{ product: "Basic", premium: 1000000 }],
        analysisUnavailable: true,
        publicUrl: "https://savia.test/public/quotes/" + "a".repeat(64),
      },
    },
    "",
    "1. Consultar seguros",
  );
  expect(text).toContain("Basic + PT: $1.100.000");
  expect(text).toContain("Integral: $1.200.000");
  expect(text).toContain("Full: $1.300.000");
  expect(text.match(/Responsabilidad civil/g)).toHaveLength(4);
  expect(text).toContain("deducible: 0%");
  expect(text).toContain("1. Consultar seguros");
  expect(text.length).toBeLessThanOrEqual(4096);
});

it("reserves terminal guidance and warnings before spending space on coverage summaries", () => {
  const proposals = Array.from({ length: 5 }, (_, index) => ({
    id: `offer-${index}`,
    provider: "Carrier",
    product: `Offer ${index + 1} ` + "x".repeat(110),
    state: "priced",
    premium: 1000000,
    currency: "COP",
    facts: [
      {
        label: "Verified coverage",
        value: "Verified limits and deductibles ".repeat(7),
        source: "provider",
      },
    ],
  }));
  const text = actionResultText(
    "Alice",
    "quote-auto",
    {
      state: "completed",
      result: {
        reference: "internal",
        pricedOffers: 5,
        proposals,
        recommendation:
          "Compare verified conditions. " + "Long model guidance. ".repeat(60),
        analysis: {
          proposals: proposals.map((p) => ({
            id: p.id,
            explanation: "Verified price.",
          })),
          suggestion: "Compare verified conditions.",
          limitations: [],
        },
        analysisUnavailable: true,
        persistenceWarnings: [
          "Saved results require review. " + "W".repeat(210),
        ],
        publicUrl: "https://savia.test/public/quotes/" + "a".repeat(64),
      },
    },
    "",
    "Menu: " + "M".repeat(1490),
  );
  expect(text).toContain("Compare verified conditions.");
  expect(text).toContain("El análisis automático no estuvo disponible");
  expect(text).toContain("Saved results require review.");
  expect(text).toContain("Offer 5");
  expect(text).toContain("Menu:");
  expect(text).toContain("https://savia.test/public/quotes/");
  expect(text.length).toBeLessThanOrEqual(4096);
});

it("replaces a legacy missing-coverage claim when saved proposals have verified facts", () => {
  const text = actionResultText("Alice", "quote-auto", {
    state: "completed",
    result: {
      reference: "internal",
      pricedOffers: 1,
      analysisUnavailable: true,
      recommendation: "Faltan las coberturas y deducibles.",
      proposals: [
        {
          id: "basic",
          provider: "Carrier",
          product: "Basic",
          state: "priced",
          premium: 1000000,
          currency: "COP",
          facts: [
            {
              label: "RCE",
              value: "$4.400.000.000; deducible 0%",
              source: "provider",
            },
          ],
        },
      ],
    },
  });
  expect(text).toContain("RCE");
  expect(text).not.toContain("Faltan las coberturas");
  expect(text).toContain("deducibles informados");
});
