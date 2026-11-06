import { describe, expect, it } from "vitest";
import {
  buildSecretsFile,
  mergeVariables,
  parseSecretsFile,
  pickFlowEntry,
  transferFileName,
} from "./secrets-transfer";

describe("secrets-transfer", () => {
  it("round-trips an export file with sorted flows and variables", () => {
    const text = buildSecretsFile(
      [
        {
          flowId: "liberty-quote",
          variables: [
            { key: "b_key", value: "b", secret: true },
            { key: "a_key", value: "", secret: true },
          ],
        },
        {
          flowId: "autos",
          variables: [{ key: "token", value: "x", secret: true }],
        },
      ],
      "2026-09-20T00:00:00.000Z",
    );
    const parsed = parseSecretsFile(text);
    expect(parsed).toEqual({
      version: 1,
      exportedAt: "2026-09-20T00:00:00.000Z",
      flows: [
        {
          flowId: "autos",
          variables: [{ key: "token", value: "x", secret: true }],
        },
        {
          flowId: "liberty-quote",
          variables: [
            { key: "a_key", value: "", secret: true },
            { key: "b_key", value: "b", secret: true },
          ],
        },
      ],
    });
  });

  it("rejects malformed files with actionable messages", () => {
    expect(() => parseSecretsFile("no-json")).toThrow("no es un JSON válido");
    expect(() => parseSecretsFile("{}")).toThrow("lista de flows");
    expect(() => parseSecretsFile('{"version":2,"flows":[]}')).toThrow(
      "Versión de archivo no soportada",
    );
    expect(() => parseSecretsFile('{"flows":[]}')).toThrow("no contiene flows");
    expect(() =>
      parseSecretsFile('{"flows":[{"flowId":"","variables":[]}]}'),
    ).toThrow("flowId no vacío");
    expect(() =>
      parseSecretsFile(
        '{"flows":[{"flowId":"a","variables":[{"key":"bad key!","value":"x","secret":true}]}]}',
      ),
    ).toThrow("Variable inválida");
    expect(() =>
      parseSecretsFile(
        '{"flows":[{"flowId":"a","variables":[{"key":"k","value":"1","secret":true},{"key":"k","value":"2","secret":false}]}]}',
      ),
    ).toThrow("claves duplicadas");
    expect(() =>
      parseSecretsFile(
        '{"flows":[{"flowId":"a","variables":[]},{"flowId":"a","variables":[]}]}',
      ),
    ).toThrow("flows duplicados");
  });

  it("merges imports without deleting and skips empty values", () => {
    const { merged, applied, skippedEmpty } = mergeVariables(
      [
        { key: "keep", value: "prod", secret: true, configured: true },
        { key: "token", value: "", secret: true, configured: true },
      ],
      [
        { key: "token", value: "nuevo", secret: true },
        { key: "keep", value: "", secret: true },
        { key: "extra", value: "https://api.test", secret: false },
      ],
    );
    expect(merged).toEqual([
      { key: "keep", value: "prod", secret: true, configured: true },
      { key: "token", value: "nuevo", secret: true, configured: true },
      { key: "extra", value: "https://api.test", secret: false },
    ]);
    expect(applied).toBe(2);
    expect(skippedEmpty).toBe(1);
  });

  it("picks the matching flow entry or a single-flow fallback", () => {
    const file = parseSecretsFile(
      '{"flows":[{"flowId":"a","variables":[]},{"flowId":"b","variables":[]}]}',
    );
    expect(pickFlowEntry(file, "b").flowId).toBe("b");
    const single = parseSecretsFile(
      '{"flows":[{"flowId":"x","variables":[]}]}',
    );
    expect(pickFlowEntry(single, "other").flowId).toBe("x");
    expect(() => pickFlowEntry(file, "missing")).toThrow(
      "no contiene secretos para este flow",
    );
  });

  it("builds safe file names", () => {
    expect(transferFileName("todos", "2026-09-20T10:00:00.000Z")).toBe(
      "savia-request-secretos-todos-2026-09-20.json",
    );
    expect(transferFileName("Sura Autos!!", "2026-09-20T10:00:00.000Z")).toBe(
      "savia-request-secretos-sura-autos-2026-09-20.json",
    );
  });
});
