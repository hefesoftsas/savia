import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBusinessSampleRecords,
  sampleSelection,
} from "./import-business-sample.mjs";

test("builds an ordered twenty-record business sample", () => {
  assert.equal(sampleSelection.length, 20);
  assert.deepEqual(
    sampleSelection.map(({ sourceTable, id }) => `${sourceTable}:${id}`),
    [
      "business_agency:3",
      "business_agency:2",
      "business_agency:15",
      "business_agencycontact:4",
      "business_commercialunit:25",
      "app_documenttag:351",
      "operation_tasktag:13",
      "customer_group:2",
      "customer_client:3530",
      "customer_client:32555",
      "customer_clientagency:3531",
      "customer_clientagency:93250",
      "customer_naturalperson:2655",
      "customer_naturalperson:23504",
      "insurance_policy:5853",
      "insurance_term:41761",
      "operation_payment:23889",
      "claim_claim:1490",
      "sales_sale:1341",
      "sales_sale:1342",
    ],
  );

  const records = buildBusinessSampleRecords({
    business_agency: [
      {
        id: 3,
        id_slug: "agency-3",
        created_at: "2025-01-01T00:00:00+00:00",
        updated_at: "2025-01-02T00:00:00+00:00",
        name: "Agency 3",
        address: "Street 3",
        id_check_digit: "1",
        id_number: "900000003",
        phone: null,
        logo: null,
        city_id: 126,
        coordinates: null,
        lr_id_number: "3",
        lr_id_type: "CC",
        lr_name: "Representative",
        payments_email: "payments@example.test",
        is_active: true,
        email: "hello@example.test",
        is_in_house: false,
        email_domain: "example.test",
        birthday_from_email: "birthdays@example.test",
        payment_from_email: "payments@example.test",
        renewal_from_email: "renewals@example.test",
        home_url: "https://example.test",
        short_name: "A3",
        seller_required: false,
        has_compliance: false,
        default_cc_emails: ["one@example.test"],
        surnames: "Representative",
        type: "broker",
        theme: "default",
        retirement_date: null,
      },
    ],
    customer_naturalperson: [
      {
        id: 2655,
        id_slug: "person-2655",
        created_at: "2025-01-01T00:00:00+00:00",
        updated_at: "2025-01-02T00:00:00+00:00",
        surname: "Person",
        birth_date: null,
        phone: "3000000000",
        id_type: "CC",
        id_number: "1000002655",
        id_issue_at: null,
        marital_status: "single",
        occupation: "Professional",
        company: "Example",
        home_address_id: null,
        work_address_id: null,
        genre: "unspecified",
        name: "Sample",
        email: ["sample@example.test", "other@example.test"],
        client_id: 3531,
      },
    ],
  });

  assert.deepEqual(
    records.map(({ targetTable, id }) => [targetTable, id]),
    [
      ["agencies", 3],
      ["customer_naturalperson", 2655],
    ],
  );
  assert.equal(records[0].values.default_cc_emails, '["one@example.test"]');
  assert.equal(records[1].values.email, "sample@example.test");
});

test("serializes source JSON fields before inserting into D1 text columns", () => {
  const [record] = buildBusinessSampleRecords({
    customer_clientagency: [
      {
        id: 3531,
        id_slug: "client-agency-3531",
        created_at: "2025-01-01T00:00:00+00:00",
        updated_at: "2025-01-02T00:00:00+00:00",
        agency_id: 2,
        client_id: 3530,
        created_by: "system",
        created_by_slug: "source",
        birthday_notification: true,
        payment_notification: true,
        renewal_notification: false,
        commercial_unit_id: null,
        group_id: null,
        document_url: "",
        computed_data: { source: "postgres" },
        completed_at: null,
        origin_from_prospects: false,
      },
    ],
  });

  assert.equal(record.targetTable, "customer_clientagency");
  assert.equal(record.values.computed_data, '{"source":"postgres"}');
  assert.equal(record.values.birthday_notification, 1);
  assert.equal(record.values.renewal_notification, 0);
});
