import { describe, expect, it } from "vitest";
import {
  insuranceWhatsappContribution,
  insuranceVehicleQuoteWhatsappFlow,
  validateWhatsappVehicleQuoteIntake,
} from "../src/whatsapp";
import { insuranceQuoteProductCatalog } from "../src/configuration";

const validIntake = {
  vehicle_plate: "ABC123",
  vehicle_fasecoldaCode: "04408010",
  vehicle_productionYear: "2023",
  vehicle_isNew: false,
  vehicle_circulationCity: "11001",
  vehicle_accessoriesValue: "0",
  vehicle_declaredValue: "65000000",
  applicant_documentType: "CC",
  applicant_documentNumber: "12345678",
  applicant_firstName: "Ana",
  applicant_surname: "Pérez",
  applicant_secondSurname: "",
  applicant_gender: "F",
  applicant_birthDate: "1990-01-01",
  applicant_city: "11001",
  applicant_address: "Calle 1",
  applicant_phone: "3001234567",
  applicant_email: "ana@example.com",
  consent_quote_processing: true,
};

describe("WhatsApp insurance intake contribution", () => {
  it("rejects malformed vehicle plates", () => {
    expect(() =>
      validateWhatsappVehicleQuoteIntake({
        ...validIntake,
        vehicle_plate: "AB 123",
      }),
    ).toThrow();
  });

  it("rejects a vehicle year outside the quote form's accepted range", () => {
    expect(() =>
      validateWhatsappVehicleQuoteIntake({
        ...validIntake,
        vehicle_productionYear: "1800",
      }),
    ).toThrow();
  });

  it("requires explicit consent before returning canonical quote input", () => {
    expect(() =>
      validateWhatsappVehicleQuoteIntake({
        ...validIntake,
        consent_quote_processing: false,
      }),
    ).toThrow();
  });

  it("uses the plugin's canonical vehicle and applicant shape", () => {
    expect(validateWhatsappVehicleQuoteIntake(validIntake)).toEqual({
      vehicle: {
        plate: "ABC123",
        fasecoldaCode: "04408010",
        productionYear: 2023,
        isNew: false,
        circulationCity: "11001",
        accessoriesValue: 0,
        declaredValue: 65000000,
      },
      applicant: {
        documentType: "CC",
        documentNumber: "12345678",
        firstName: "Ana",
        surname: "Pérez",
        gender: "F",
        birthDate: "1990-01-01",
        city: "11001",
        address: "Calle 1",
        phone: "3001234567",
        email: "ana@example.com",
      },
    });
  });

  it("publishes a static terminal Flow with the existing required quote fields", () => {
    expect(insuranceVehicleQuoteWhatsappFlow.version).toBe("7.3");
    const components = insuranceVehicleQuoteWhatsappFlow.screens.flatMap(
      (screen) => screen.layout.children.flatMap((form) => form.children),
    );
    const fields = components
      .filter((component) => "name" in component)
      .map((component) => component.name);
    expect(fields).toEqual(
      expect.arrayContaining([
        "vehicle_plate",
        "vehicle_fasecoldaCode",
        "vehicle_productionYear",
        "vehicle_isNew",
        "vehicle_circulationCity",
        "vehicle_declaredValue",
        "applicant_documentType",
        "applicant_documentNumber",
        "applicant_firstName",
        "applicant_surname",
        "applicant_gender",
        "applicant_birthDate",
        "applicant_city",
        "applicant_address",
        "applicant_phone",
        "applicant_email",
        "consent_quote_processing",
      ]),
    );
    expect(
      insuranceVehicleQuoteWhatsappFlow.screens.filter(
        (screen) => screen.terminal,
      ),
    ).toHaveLength(1);
    expect(components.map((component) => component.type)).toEqual(
      expect.arrayContaining([
        "TextInput",
        "Dropdown",
        "DatePicker",
        "Dropdown",
        "OptIn",
        "Footer",
      ]),
    );
  });

  it("propagates every prior-screen field through declared data into completion", () => {
    const [vehicle, applicant, contact] =
      insuranceVehicleQuoteWhatsappFlow.screens;
    const form = (
      screen: (typeof insuranceVehicleQuoteWhatsappFlow.screens)[number],
    ) => screen.layout.children[0];
    const footer = (
      screen: (typeof insuranceVehicleQuoteWhatsappFlow.screens)[number],
    ) =>
      form(screen).children.find(
        (component) => component.type === "Footer",
      ) as {
        "on-click-action": {
          name: string;
          payload: Record<string, string>;
          next?: { name: string };
        };
      };

    expect(vehicle.data).toEqual({});
    const vehicleFieldNames = [
      "vehicle_plate",
      "vehicle_fasecoldaCode",
      "vehicle_productionYear",
      "vehicle_isNew",
      "vehicle_circulationCity",
      "vehicle_accessoriesValue",
      "vehicle_declaredValue",
    ];
    const applicantFieldNames = [
      "applicant_documentType",
      "applicant_documentNumber",
      "applicant_firstName",
      "applicant_surname",
      "applicant_secondSurname",
      "applicant_gender",
      "applicant_birthDate",
    ];
    const contactFieldNames = [
      "applicant_city",
      "applicant_address",
      "applicant_phone",
      "applicant_email",
    ];
    expect(footer(vehicle)["on-click-action"]).toMatchObject({
      name: "navigate",
      next: { name: "APPLICANT" },
      payload: Object.fromEntries(
        vehicleFieldNames.map((key) => [key, `\${form.${key}}`]),
      ),
    });
    expect(Object.keys(applicant.data ?? {}).sort()).toEqual(
      vehicleFieldNames.sort(),
    );
    expect(applicant.data).toMatchObject({
      vehicle_plate: { type: "string", __example__: "ABC123" },
      vehicle_isNew: { type: "string", __example__: "false" },
    });
    expect(footer(applicant)["on-click-action"].payload).toMatchObject({
      vehicle_plate: "${data.vehicle_plate}",
      vehicle_isNew: "${data.vehicle_isNew}",
      applicant_firstName: "${form.applicant_firstName}",
    });
    expect(contact.data).toHaveProperty("vehicle_plate");
    expect(contact.data).toHaveProperty("applicant_firstName");
    expect(Object.keys(contact.data ?? {}).sort()).toEqual(
      [...vehicleFieldNames, ...applicantFieldNames].sort(),
    );
    const complete = footer(contact)["on-click-action"];
    expect(complete.name).toBe("complete");
    expect(complete.payload).toMatchObject({
      vehicle_plate: "${data.vehicle_plate}",
      applicant_firstName: "${data.applicant_firstName}",
      applicant_city: "${form.applicant_city}",
      consent_quote_processing: "${form.consent_quote_processing}",
    });
    expect(Object.keys(complete.payload).sort()).toEqual(
      [
        ...vehicleFieldNames,
        ...applicantFieldNames,
        ...contactFieldNames,
        "consent_quote_processing",
      ].sort(),
    );
    expect(JSON.stringify(insuranceVehicleQuoteWhatsappFlow)).not.toContain(
      "screen.VEHICLE.form",
    );
    expect(JSON.stringify(insuranceVehicleQuoteWhatsappFlow)).not.toContain(
      "screen.APPLICANT.form",
    );
  });

  it("normalizes the Flow boolean dropdown without accepting arbitrary values", () => {
    expect(
      validateWhatsappVehicleQuoteIntake({
        ...validIntake,
        vehicle_isNew: "true",
      }),
    ).toMatchObject({ vehicle: { isNew: true } });
    expect(() =>
      validateWhatsappVehicleQuoteIntake({
        ...validIntake,
        vehicle_isNew: "yes",
      }),
    ).toThrow();
  });

  it("references only existing plugin IDs and leaves provider execution disabled", () => {
    expect(insuranceWhatsappContribution).toMatchObject({
      pluginId: "insurance.quotes",
      solutionId: "savia.insurance-quoter",
      bundleId: "insurance-auto-light",
      providerExecutionEnabled: false,
    });
    expect(insuranceWhatsappContribution.products).toEqual(
      insuranceQuoteProductCatalog,
    );
  });
});
