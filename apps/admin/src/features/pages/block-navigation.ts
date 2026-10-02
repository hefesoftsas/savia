import type { SlateEditor } from "platejs";

const nonTextBlocks = new Set(["issue", "collection", "attachment", "divider"]);

/** Cross top-level block edges without interfering with selection or line navigation. */
export function navigateBlockEdge(
  editor: SlateEditor,
  direction: -1 | 1,
): boolean {
  const selection = editor.selection;
  if (!selection || !editor.api.isCollapsed()) return false;
  const index = selection.focus.path[0];
  const node = editor.children[index];
  if (!node) return false;
  const path = [index];
  const atEdge =
    direction < 0
      ? editor.api.isStart(selection.focus, path)
      : editor.api.isEnd(selection.focus, path);
  if (!atEdge) return false;
  let target = index + direction;
  while (
    target >= 0 &&
    target < editor.children.length &&
    nonTextBlocks.has(String(editor.children[target].type))
  )
    target += direction;
  if (target < 0 || target >= editor.children.length) {
    if (node.type === "p" && Math.abs(target - index) === 1) return false;
    target = direction < 0 ? 0 : editor.children.length;
    editor.tf.insertNodes(
      { type: "p", children: [{ text: "" }] },
      { at: [target] },
    );
  }
  const point =
    direction < 0 ? editor.api.end([target]) : editor.api.start([target]);
  if (!point) return false;
  editor.tf.select(point);
  return true;
}
