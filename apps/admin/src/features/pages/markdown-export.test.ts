import { expect, it } from "vitest";
import { exportPageMarkdown } from "./markdown-export";

it("exports page text, marks, links, headings, lists, tasks, quotes and callouts", () => {
  const markdown = exportPageMarkdown("Release notes", [
    {
      type: "h1",
      children: [{ text: "What's new", bold: true }],
    },
    {
      type: "p",
      children: [
        { text: "Useful ", italic: true },
        {
          type: "a",
          url: "https://example.test/a b",
          children: [{ text: "link" }],
        },
      ],
    },
    { type: "bullet", children: [{ text: "First" }] },
    { type: "numbered", children: [{ text: "Second" }] },
    { type: "todo", checked: true, children: [{ text: "Ship it" }] },
    { type: "blockquote", children: [{ text: "Quoted" }] },
    { type: "callout", children: [{ text: "Remember" }] },
  ]);
  expect(markdown).toContain("# Release notes\n\n# **What's new**");
  expect(markdown).toContain("_Useful_ [link](https://example.test/a%20b)");
  expect(markdown).toContain("- First\n\n1. Second\n\n- [x] Ship it");
  expect(markdown).toContain("> Quoted\n\n> **Note:** Remember");
});

it("uses safe fenced code and includes toggle and table content", () => {
  const markdown = exportPageMarkdown("Code", [
    {
      type: "code_block",
      language: "typescript",
      children: [{ text: "const marker = ```;" }],
    },
    {
      type: "toggle",
      children: [
        { type: "p", children: [{ text: "Details" }] },
        { type: "p", children: [{ text: "Hidden body" }] },
      ],
    },
    {
      type: "table",
      children: [
        {
          type: "table_row",
          children: [
            {
              type: "table_cell",
              children: [{ type: "p", children: [{ text: "A|B" }] }],
            },
            {
              type: "table_cell",
              children: [{ type: "p", children: [{ text: "Value" }] }],
            },
          ],
        },
        {
          type: "table_row",
          children: [
            {
              type: "table_cell",
              children: [{ type: "p", children: [{ text: "one" }] }],
            },
            {
              type: "table_cell",
              children: [{ type: "p", children: [{ text: "two" }] }],
            },
          ],
        },
      ],
    },
  ]);
  expect(markdown).toContain("````typescript\nconst marker = ```;\n````");
  expect(markdown).toContain("<summary>Details</summary>\n\nHidden body");
  expect(markdown).toContain("| A\\|B | Value |\n| --- | --- |\n| one | two |");
});

it("exports reference blocks without private preview data or attachment ids", () => {
  const markdown = exportPageMarkdown("References", [
    {
      type: "issue",
      url: "https://linear.app/team/issue/ABC-12",
      preview: {
        title: "Private issue title",
        status: "Secret",
        assignee: "Person",
      },
      children: [{ text: "" }],
    },
    {
      type: "collection",
      domain: "/v1/studio/7",
      collection: "projects",
      mode: "table",
      rows: [{ title: "Private row data" }],
      children: [{ text: "" }],
    },
    {
      type: "attachment",
      fileId: "internal-file-id",
      name: "brief.pdf",
      url: "https://private.test/download",
      children: [{ text: "" }],
    },
  ]);
  expect(markdown).toContain("[Issue](https://linear.app/team/issue/ABC-12)");
  expect(markdown).toContain("Collection view: **projects** (table)");
  expect(markdown).toContain("📎 brief\\.pdf");
  for (const privateValue of [
    "Private issue title",
    "Secret",
    "Person",
    "Private row data",
    "internal-file-id",
    "private.test",
  ])
    expect(markdown).not.toContain(privateValue);
});

it("rejects unsafe links and provides an untitled heading for blank titles", () => {
  expect(
    exportPageMarkdown("", [
      { type: "issue", url: "javascript:alert(1)", children: [] },
      {
        type: "p",
        children: [
          {
            type: "a",
            url: "javascript:alert(2)",
            children: [{ text: "unsafe" }],
          },
        ],
      },
    ]),
  ).toBe("# Untitled\n\nIssue link unavailable\n\nunsafe\n");
});

it("escapes literal Markdown syntax and raw HTML in text", () => {
  expect(
    exportPageMarkdown("Literal *title*", [
      {
        type: "p",
        children: [
          { text: "*not emphasis* [not a link] <script>alert(1)</script>" },
        ],
      },
    ]),
  ).toBe(
    "# Literal \\*title\\*\n\n\\*not emphasis\\* \\[not a link\\] \\<script\\>alert\\(1\\)\\</script\\>\n",
  );
});
