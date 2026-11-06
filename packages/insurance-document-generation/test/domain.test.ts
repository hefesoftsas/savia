import { expect, it } from "vitest";
import { renderDocument, interpolate } from "../src/domain";
it("escapes both templates and values and rejects missing variables", () => {
  const html = renderDocument("Policy <test>", "Hello {{name}}", {
    name: "<script>alert(1)</script>",
  });
  expect(html).not.toContain("<script>");
  expect(html).toContain("&lt;script&gt;");
  expect(html).toContain("Policy &lt;test&gt;");
  expect(() => interpolate("{{missing}}", {})).toThrow();
  expect(() => interpolate("{{constructor}}", {})).toThrow();
});
