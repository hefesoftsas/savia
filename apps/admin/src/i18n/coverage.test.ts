import { describe, expect, it } from "vitest";
import { untranslatedCopy } from "./source-audit";
import exceptions from "./source-exceptions.json";
import type { MessageCatalog } from "./core";
const catalogs = import.meta.glob("./locales/*.ts", { eager: true });
const sourceFiles = import.meta.glob(
  [
    "../components/admin/*.tsx",
    "../components/ui/*.tsx",
    "../features/studio-engine/*.tsx",
    "../features/access-control/*.tsx",
    "../features/assistant-configuration/*.tsx",
    "../features/public-forms/*.tsx",
    "../features/account/*.tsx",
    "../features/users/*.tsx",
    "../features/tenants/*.tsx",
    "../features/tenant-branding/*.tsx",
    "../features/service-credentials/*.tsx",
    "!**/*.test.tsx",
  ],
  { eager: true, query: "?raw", import: "default" },
);
const tokens = (text: string) =>
  [...new Set(text.match(/%\{[^}]+\}/g) ?? [])].sort();
describe("localization coverage contract", () => {
  it("detects visible, accessible and conditional untranslated copy without flagging machine or user values", () => {
    const result = untranslatedCopy(
      "example.tsx",
      `function Example(){return <><button title="Remove">Delete</button><input placeholder={busy ? "Wait" : "Search"} value="machine"/><p>{user.label}</p><p>{t('translated')}</p></>}`,
    );
    expect(result.map((x) => x.text)).toEqual([
      "Remove",
      "Delete",
      "Wait",
      "Search",
    ]);
  });
  it("ships three nonempty translations with identical interpolation arguments for every core message", () => {
    let count = 0;
    for (const module of Object.values(catalogs))
      for (const [name, catalog] of Object.entries(module as object)) {
        if (
          name === "spanishRaMessages" ||
          !name.endsWith("Messages") ||
          !catalog ||
          typeof catalog !== "object"
        )
          continue;
        for (const [key, entries] of Object.entries(
          catalog as MessageCatalog,
        )) {
          expect(entries, `${name}.${key}`).toHaveLength(3);
          for (const text of entries) {
            expect(text.trim(), `${name}.${key}`).not.toBe("");
            expect(tokens(text), `${name}.${key}`).toEqual(tokens(entries[0]));
          }
          count++;
        }
      }
    expect(count).toBeGreaterThan(100);
  });
  it("keeps covered core screen copy in locale catalogs", () => {
    const diagnostics = Object.entries(sourceFiles).flatMap(([file, source]) =>
      untranslatedCopy(file, String(source)),
    );
    expect(
      diagnostics.filter(
        (d) =>
          !exceptions.some(
            (e) =>
              e.file === d.file && e.text === d.text && e.reason.length > 20,
          ),
      ),
    ).toEqual([]);
  });
});
