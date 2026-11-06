import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { StoreContextProvider, memoryStore, useLocaleState } from "ra-core";
import { AppLocaleProvider } from "@/i18n/app-locale-provider";
import { integrationMessages } from "@/i18n/locales/integrations";
import { automationMessages } from "@/i18n/locales/automation";
import { translateMessage } from "@/i18n/core";
import type { WorkflowTriggerCondition } from "@savia/studio-shared/workflows";
import { TriggerConditions } from "../workflow-trigger-conditions";
import { ValueInput } from "../workflow-editor";
import type { AppLocale } from "@/i18n/app-locale";

afterEach(cleanup);

function LocaleSwitch() {
  const [, setLocale] = useLocaleState();
  return (
    <>
      <button onClick={() => setLocale("en")}>EN</button>
      <button onClick={() => setLocale("pt")}>PT</button>
    </>
  );
}

function ConditionEditor() {
  const [conditions, setConditions] = useState<WorkflowTriggerCondition[]>([
    { field: "custom_name", operator: "eq", value: "Original" },
  ]);
  return (
    <>
      <LocaleSwitch />
      <TriggerConditions
        conditions={conditions}
        mode="all"
        fields={[{ name: "custom_name", label: "Nombre personalizado" }]}
        onChange={setConditions}
        onModeChange={() => {}}
      />
    </>
  );
}

describe("automation localization", () => {
  it("changes mounted condition labels without rewriting custom field names or input", async () => {
    render(
      <StoreContextProvider value={memoryStore({ locale: "es" })}>
        <AppLocaleProvider>
          <ConditionEditor />
        </AppLocaleProvider>
      </StoreContextProvider>,
    );
    fireEvent.change(screen.getByLabelText("Valor de condición 1"), {
      target: { value: "Texto propio <b>" },
    });
    fireEvent.click(screen.getByText("EN"));
    await waitFor(() =>
      expect(screen.getByLabelText("Condition value 1")).toHaveValue(
        "Texto propio <b>",
      ),
    );
    expect(screen.getByRole("option", { name: "Equals" })).toHaveValue("eq");
    expect(
      screen.getByRole("option", { name: "Nombre personalizado" }),
    ).toHaveValue("custom_name");
    fireEvent.click(screen.getByText("PT"));
    await waitFor(() =>
      expect(screen.getByLabelText("Valor da condição 1")).toHaveValue(
        "Texto propio <b>",
      ),
    );
    expect(screen.getByRole("option", { name: "É igual a" })).toHaveValue("eq");
  });

  it.each([
    ["es", "Tipo de Custom label", "Número"],
    ["en", "Type of Custom label", "Number"],
    ["pt", "Tipo de Custom label", "Número"],
  ] as const)(
    "localizes accessible names in %s and preserves workflow value types",
    (locale, accessibleName, caption) => {
      const onChange = vi.fn();
      render(
        <StoreContextProvider value={memoryStore({ locale })}>
          <AppLocaleProvider>
            <ValueInput
              label="Custom label"
              value="Custom value"
              onChange={onChange}
              variables={[]}
            />
          </AppLocaleProvider>
        </StoreContextProvider>,
      );
      const select = screen.getByLabelText(accessibleName);
      expect(screen.getByRole("option", { name: caption })).toHaveValue(
        "number",
      );
      fireEvent.change(select, { target: { value: "number" } });
      expect(onChange).toHaveBeenCalledWith(0);
    },
  );

  it("ships complete catalogs with matching interpolation tokens in every locale", () => {
    for (const [key, messages] of Object.entries({
      ...automationMessages,
      ...integrationMessages,
    })) {
      const tokens = (value: string) =>
        [...value.matchAll(/%\{([^}]+)\}/g)].map((match) => match[1]).sort();
      expect(messages, key).toHaveLength(3);
      for (const message of messages) {
        expect(message.trim().length, key).toBeGreaterThan(0);
        expect(tokens(message), key).toEqual(tokens(key));
      }
    }
    for (const locale of ["es", "en", "pt"] as AppLocale[]) {
      expect(
        translateMessage(
          automationMessages,
          "Conexiones de %{value0}",
          locale,
          { value0: "Mi conexión" },
        ),
      ).toContain("Mi conexión");
    }
  });
});
