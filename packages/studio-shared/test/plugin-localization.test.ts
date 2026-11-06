import { describe, expect, it } from "vitest";
import { resolveLocalizedContent, translatePluginMessage, localizeExternalError } from "../src/plugin-localization";
const messages = { hello: ["Hola %{name}", "Hello %{name}", "Olá %{name}"] } as const;
describe("extension localization", () => {
  it("selects language and interpolates user values only once", () => {
    expect(translatePluginMessage(messages, "hello", "en", {name:"%{name}<b>"})).toBe("Hello %{name}<b>");
    expect(translatePluginMessage(messages, "hello", "pt", {name:"Ana"})).toBe("Olá Ana");
  });
  it("falls back to authored default without translating arbitrary values", () => {
    expect(resolveLocalizedContent("Save", {pt:"Salvar"}, "en")).toBe("Save");
    expect(resolveLocalizedContent("Save", {pt:"Salvar"}, "pt")).toBe("Salvar");
    expect(resolveLocalizedContent("Original", {en:" "}, "en")).toBe("Original");
  });
  it("maps structured failures and retains the untouched technical detail", () => {
    const raw = { status:429, code:"rate_limited", message:"Provider X: quota exceeded" };
    const result = localizeExternalError(raw, "pt");
    expect(result.message).toContain("solicitações");
    expect(result.detail).toBe(raw.message);
    expect(raw.message).toBe("Provider X: quota exceeded");
    expect(localizeExternalError({status:401,message:"raw"},"en").message).toContain("sign in");
    expect(localizeExternalError(new Error("Unknown provider text"),"es").detail).toBe("Unknown provider text");
  });
});

import { createPluginApi } from "../src/plugin-api";
it("exposes live locale through a stable plugin API without replacing requests", () => {
  let locale: "es"|"en"|"pt" = "es";
  const api = createPluginApi({extensionId:"example", request:async () => ({} as never), getLocale:()=>locale});
  expect(api.i18n?.locale).toBe("es");
  locale = "pt";
  expect(api.i18n?.locale).toBe("pt");
  expect(api.i18n?.translate(messages,"hello",{name:"Ana"})).toBe("Olá Ana");
});

import { extensionManifestSchema } from "../src/extension-package";
it("keeps optional authored extension labels while preserving stable identity",()=>{
 const manifest=extensionManifestSchema.parse({format:"savia.extension",formatVersion:1,id:"sample.extension",version:"1.0.0",apiVersion:1,label:"Default",description:"",labels:{pt:"Português"},descriptions:{en:"English description"}});
 expect(manifest.id).toBe("sample.extension");
 expect(resolveLocalizedContent(manifest.label,manifest.labels,"pt")).toBe("Português");
 expect(resolveLocalizedContent(manifest.label,manifest.labels,"es")).toBe("Default");
});
