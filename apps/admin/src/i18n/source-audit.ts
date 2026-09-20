/** Test/build-time audit. Never imported by the application bundle. */
import ts from "typescript";
export type UntranslatedCopy = { file: string; line: number; text: string };
const uiAttributes = new Set([
  "aria-label",
  "aria-description",
  "title",
  "placeholder",
  "label",
  "description",
  "help",
  "emptyText",
]);
const humanText = (text: string) => /[A-Za-zÀ-ÿ]{2}/u.test(text);

export function untranslatedCopy(
  file: string,
  source: string,
): UntranslatedCopy[] {
  const tree = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const found: UntranslatedCopy[] = [];
  const add = (node: ts.Node, raw: string) => {
    const text = raw.replace(/\s+/g, " ").trim();
    if (humanText(text.replace(/%\{[^}]+\}/g, "")))
      found.push({
        file,
        line: tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1,
        text,
      });
  };
  const literals = (node: ts.Expression) => {
    if (ts.isStringLiteralLike(node)) add(node, node.text);
    else if (ts.isTemplateExpression(node)) {
      add(
        node,
        node.head.text +
          node.templateSpans
            .map((span) => `%{value}${span.literal.text}`)
            .join(""),
      );
    } else if (ts.isConditionalExpression(node)) {
      literals(node.whenTrue);
      literals(node.whenFalse);
    } else if (
      ts.isBinaryExpression(node) &&
      [
        ts.SyntaxKind.QuestionQuestionToken,
        ts.SyntaxKind.BarBarToken,
        ts.SyntaxKind.AmpersandAmpersandToken,
      ].includes(node.operatorToken.kind)
    )
      literals(node.right);
    else if (ts.isParenthesizedExpression(node)) literals(node.expression);
  };
  const visit = (node: ts.Node) => {
    // <Translate> children are an explicitly configured fallback, not untranslated UI.
    if (
      ts.isJsxElement(node) &&
      node.openingElement.tagName.getText(tree) === "Translate"
    )
      return;
    if (ts.isJsxText(node)) add(node, node.text);
    if (
      ts.isJsxAttribute(node) &&
      uiAttributes.has(node.name.getText(tree)) &&
      node.initializer
    ) {
      if (ts.isStringLiteral(node.initializer))
        add(node.initializer, node.initializer.text);
      else if (
        ts.isJsxExpression(node.initializer) &&
        node.initializer.expression
      )
        literals(node.initializer.expression);
    }
    if (
      ts.isJsxExpression(node) &&
      !ts.isJsxAttribute(node.parent) &&
      node.expression
    )
      literals(node.expression);
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return found;
}
