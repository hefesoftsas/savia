// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { configSchema } from "@savia/crm-shared/metadata";
import {
  buildFormHtmlRuntimeContext,
  renderFormHtmlTemplate,
  resolveFormHtml,
  resolveSavinaSetValueAction,
  runFormHtmlScript,
  sanitizeFormHtml,
  validateFormHtmlScript,
} from "@savia/crm-shared/form-html";

describe("form html field", () => {
  it("renders template variables with escaped values", () => {
    expect(
      renderFormHtmlTemplate("<p>{{values.placa}} · {{record.id}}</p>", {
        values: { placa: "TESTCAR<script>" },
        recordId: "rec-1",
        object: { name: "vehicles", label: "Vehículos" },
      }),
    ).toBe("<p>TESTCAR&lt;script&gt; · rec-1</p>");
  });

  it("sanitizes dangerous html", () => {
    expect(
      sanitizeFormHtml('<div onclick="alert(1)"><script>x</script>Ok</div>'),
    ).toBe("<div>Ok</div>");
  });

  it("setValue in script context only allows known fields", () => {
    const setValue = vi.fn();
    const ctx = buildFormHtmlRuntimeContext({
      values: { placa: "TESTCAR" },
      setValue,
      object: {
        name: "vehicles",
        label: "Vehículos",
        description: "",
        config: {
          fields: {
            placa: { type: "Textbox", label: "Placa" },
          },
          fieldOrder: ["placa"],
        },
      },
      container: {} as HTMLElement,
    });
    ctx.setValue("placa", "NEXTTEST");
    expect(setValue).toHaveBeenCalledWith("placa", "NEXTTEST");
    expect(() => ctx.setValue("missing", "x")).toThrow(/desconocido/);
  });

  it("blocks disallowed script patterns", () => {
    expect(validateFormHtmlScript("eval('x')")).toMatch(/no permitidas/);
  });

  it("resolves declarative set-value buttons", () => {
    const button = document.createElement("button");
    button.setAttribute("data-savia-set-value", "nombre");
    button.setAttribute("data-savia-value", "Ejemplo");
    expect(
      resolveSavinaSetValueAction(button, { nombre: "Ana" }),
    ).toEqual({ field: "nombre", value: "Ejemplo" });
    button.setAttribute("data-savia-value", "field:nombre");
    expect(
      resolveSavinaSetValueAction(button, { nombre: "Ana" }),
    ).toEqual({ field: "nombre", value: "Ana" });
  });

  it("only updates markup when rendered html changes", async () => {
    const { syncFormHtmlMarkup } = await import("../form-html-field");
    const node = document.createElement("div");
    const previous = { current: "" };
    expect(syncFormHtmlMarkup(node, "<p>A</p>", previous)).toBe(true);
    expect(node.innerHTML).toBe("<p>A</p>");
    expect(syncFormHtmlMarkup(node, "<p>A</p>", previous)).toBe(false);
    expect(syncFormHtmlMarkup(node, "<p>B</p>", previous)).toBe(true);
    expect(node.innerHTML).toBe("<p>B</p>");
  });

  it("validates metadata for FormHtml fields", () => {
    const parsed = configSchema.safeParse({
      version: 2,
      fields: {
        banner: {
          type: "FormHtml",
          label: "Banner",
          readOnly: true,
          config: {
            formHtml: {
              html: "<p>{{values.nombre}}</p>",
            },
          },
        },
      },
      fieldOrder: ["banner"],
    });
    if (!parsed.success) {
      throw new Error(parsed.error.issues.map((issue) => issue.message).join("; "));
    }
    expect(parsed.success).toBe(true);
    expect(
      resolveFormHtml({
        formHtml: { html: "<p>Hola</p>" },
      }),
    ).toEqual({ html: "<p>Hola</p>", script: undefined });
  });
});
