import { createContext } from "react";
import type {
  CompletionContext,
  CompletionSource,
} from "@codemirror/autocomplete";

export const VariableNames = createContext<string[]>([]);

export function templateAt(text: string, cursor: number) {
  const from = text.lastIndexOf("{{", cursor);
  if (from < 0 || text.slice(from + 2, cursor).includes("}")) return null;
  return { from, query: text.slice(from + 2, cursor) };
}

export function templateEnd(text: string, cursor: number) {
  const closing = text.indexOf("}}", cursor);
  return closing < 0 ? cursor : closing + 2;
}

export function variableCompletion(names: string[]): CompletionSource {
  return (context: CompletionContext) => {
    const match = templateAt(context.state.sliceDoc(), context.pos);
    if (!match) return null;
    return {
      from: match.from,
      options: names.map((name) => ({
        label: `{{${name}}}`,
        type: "variable",
        apply: `{{${name}}}`,
      })),
      validFor: /^\{\{[^{}\s]*$/,
    };
  };
}
