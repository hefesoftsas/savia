import { createBlockFenceInputRule, type Value } from "platejs";

const aliases: Record<string, string> = {
  js: "javascript",
  ts: "typescript",
  py: "python",
  sh: "bash",
  yml: "yaml",
  text: "plain",
  txt: "plain",
};
export function codeLanguage(value: string) {
  return aliases[value.toLowerCase()] ?? (value.toLowerCase() || "plain");
}

/** Recognize complete fenced code snippets without altering ordinary clipboard text. */
export function fencedCodePaste(text: string): Value | null {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Value = [];
  let found = false;
  for (let index = 0; index < lines.length; index++) {
    const fence = /^\s*(`{3,}|~{3,})([\w+-]*)\s*$/.exec(lines[index]);
    if (!fence) {
      blocks.push({ type: "p", children: [{ text: lines[index] }] });
      continue;
    }
    const content: string[] = [];
    const close = new RegExp(`^\\s*${fence[1][0]}{${fence[1].length},}\\s*$`);
    while (++index < lines.length && !close.test(lines[index]))
      content.push(lines[index]);
    if (index === lines.length) return null;
    found = true;
    blocks.push({
      type: "code_block",
      language: codeLanguage(fence[2]),
      children: [{ text: content.join("\n") }],
    });
  }
  return found ? blocks : null;
}

/** Use Plate's text insertion pipeline, including composed keyboard input. */
export const codeFenceInputRule = createBlockFenceInputRule({
  block: "p",
  fence: "```",
  on: "match",
  apply: ({ editor }, { path, range }) => {
    editor.tf.withoutNormalizing(() => {
      editor.tf.delete({ at: range });
      editor.tf.setNodes(
        { type: "code_block", language: "plain" },
        { at: path },
      );
    });
  },
});
