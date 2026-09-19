import { expect, it } from "vitest";
import { configSchema, makeConfig } from "../src/metadata";

const configured = (fields: string[], retentionDays = 90) => ({
  ...makeConfig({
    name: { type: "Textbox", label: "Name" },
    attachment: { type: "R2Attachment", label: "Attachment" },
    secret: { type: "Textbox", label: "Secret", config: { sensitive: true } },
  }),
  studio: { history: { enabled: true, fields, retentionDays } },
});
it("preserves opted-in record history settings", () => {
  expect(configSchema.parse(configured(["name"])).studio).toEqual({
    history: { enabled: true, fields: ["name"], retentionDays: 90 },
  });
});
it("rejects unknown, unsafe, duplicate fields and unbounded retention", () => {
  for (const fields of [
    ["missing"],
    ["attachment"],
    ["secret"],
    ["name", "name"],
    [],
  ])
    expect(configSchema.safeParse(configured(fields)).success).toBe(false);
  for (const days of [0, 366, 1.5])
    expect(configSchema.safeParse(configured(["name"], days)).success).toBe(
      false,
    );
});
