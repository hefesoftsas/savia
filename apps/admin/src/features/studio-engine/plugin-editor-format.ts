import { format } from "prettier/standalone";
import type { Plugin } from "prettier";
import * as babel from "prettier/plugins/babel";
import * as estree from "prettier/plugins/estree";
import * as typescript from "prettier/plugins/typescript";
import * as postcss from "prettier/plugins/postcss";
import * as html from "prettier/plugins/html";

const parsers: Record<string, string> = {
  typescript: "typescript",
  typescriptreact: "typescript",
  javascript: "babel",
  javascriptreact: "babel",
  json: "json",
  css: "css",
  html: "html",
};
export async function formatPluginDocument(text: string, language: string) {
  const parser = parsers[language];
  if (!parser) throw new Error(`Unsupported formatting language: ${language}`);
  // Prettier's estree plugin ships an empty declaration file in this release.
  return format(text, {
    parser,
    plugins: [babel, estree as unknown as Plugin, typescript, postcss, html],
    tabWidth: 2,
  });
}
