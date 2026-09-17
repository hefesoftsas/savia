import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCatalogRecords,
  sourceCatalogs,
} from "./parametric-catalog-migration.mjs";

test("orders dependent catalog records and omits agency-scoped records", () => {
  const records = buildCatalogRecords({
    app_country: [{ id: 1, name: "Colombia", code: "CO" }],
    app_department: [
      { id: 11, name: "Bogotá D.C.", country_id: 1, external_id: 11000 },
    ],
    app_city: [
      { id: 11001, name: "Bogotá", department_id: 11, external_id: 11001 },
    ],
    app_documenttag: [
      {
        id: 1,
        name: "Global",
        color: "#000000",
        agency_id: null,
        created_by: "seed",
      },
      {
        id: 2,
        name: "Scoped",
        color: "#000000",
        agency_id: 99,
        created_by: "seed",
      },
    ],
  });

  assert.deepEqual(
    records.map(({ sourceTable, input }) => [sourceTable, input.id]),
    [
      ["app_country", 1],
      ["app_department", 11],
      ["app_city", 11001],
      ["app_documenttag", 1],
    ],
  );
  assert.deepEqual(records[2].input, {
    id: 11001,
    name: "Bogotá",
    departmentId: 11,
    externalId: 11001,
  });
});

test("maps source row values to the matching domain command", () => {
  const [record] = buildCatalogRecords({
    business_ramo: [
      {
        id: 703,
        id_slug: "full",
        name: "Full coverage",
        sub_ramo_id: 702,
        tax_iva: 19,
        external_id: 303,
        manage_reinvestment: true,
        has_monthly_payment: true,
        allow_custom_renewal_days: true,
        is_non_renewable: false,
        insurance_subject_validation: "required",
        insurance_subject_validation_message: "Vehicle data is required",
        monthly_payment_form_label: "Monthly payment",
        compliance_policy_type: "standard",
      },
    ],
  });

  assert.equal(record.command, "define-product-line");
  assert.equal(record.collectionPath, "/v1/insurance-catalog/product-lines");
  assert.deepEqual(record.input, {
    id: 703,
    slug: "full",
    name: "Full coverage",
    specializationId: 702,
    taxIva: "19",
    externalId: 303,
    manageReinvestment: true,
    supportsMonthlyPayment: true,
    allowsCustomRenewalDays: true,
    renewable: true,
    subjectValidation: "required",
    subjectValidationMessage: "Vehicle data is required",
    monthlyPaymentFormLabel: "Monthly payment",
    compliancePolicyType: "standard",
  });
});

test("declares every source catalog table, including blocked agency-scoped catalogs", () => {
  assert.deepEqual(
    sourceCatalogs.map(({ sourceTable }) => sourceTable),
    [
      "app_country",
      "app_department",
      "app_city",
      "business_category",
      "business_subramo",
      "business_insurercompany",
      "business_ramo",
      "claim_claimtype",
      "claim_claimstatus",
      "claim_claimsubstatus",
      "sales_entity",
      "sales_operator",
      "sales_product",
      "sales_plan",
      "app_bank",
      "app_economicactivity",
      "renewal_nonrenewalreason",
      "insurance_reinvestmentactivity",
      "operation_tasktype",
      "operation_tasktag",
      "app_documenttag",
      "sales_provider",
      "business_commercialunit",
      "customer_group",
    ],
  );
});
