import { expect, it } from "vitest";
import legacyInsurance from "../../../solutions/insurance/manifest.json";
import { runtimeReleaseCatalog } from "./runtime";

it("offers independent quote and insurance management packages for new installs", () => {
  const catalog = runtimeReleaseCatalog.solutionCatalog;
  expect(catalog.map((solution) => solution.id)).toEqual([
    "savia.insurance-quoter",
    "savia.insurance-management",
  ]);

  const [quoter, management] = catalog;
  expect(quoter.requires).toEqual(["insurance.quotes"]);
  expect(quoter.objects.map((object) => object.name)).toEqual([
    "cotizaciones",
    "cotizaciones_detalle",
    "cotizador_por_pasos",
  ]);
  expect(
    quoter.objects
      .filter((object) => !object.config.studio?.screen?.hidden)
      .map((object) => object.name),
  ).toEqual(["cotizador_por_pasos"]);
  expect(management.requires).toEqual([]);
  expect(management.objects.map((object) => object.name)).not.toContain(
    "cotizador_por_pasos",
  );
  expect(management.objects.map((object) => object.name)).not.toContain(
    "cotizador",
  );
  expect(management.objects.map((object) => object.name)).not.toContain(
    "administrar_seguros",
  );
  expect(
    new Set([
      ...quoter.objects.map((object) => object.name),
      ...management.objects.map((object) => object.name),
    ]),
  ).toEqual(
    new Set(
      legacyInsurance.objects
        .map((object) => object.name)
        .filter(
          (name) => name !== "cotizador" && name !== "administrar_seguros",
        ),
    ),
  );
});
