import { createRef } from "react";
import { render } from "@testing-library/react";
import { expect, it } from "vitest";
import { createBrandIconComponent } from "./compact-brand-icon";

it("renders nested nodes and preserves refs, variants, and SVG prop overrides", () => {
  const Icon = createBrandIconComponent("NestedBrand", {
    namespaceIds: false,
    strings: ["M10 20 C30 40 50 60 70 80 C90 100 110 120 130 140 Z"],
    stringRefPrefix: "\u0000unused-ref:",
    nodes: [
      ["title", { id: "nested-title" }, ["Brand title"]],
      ["g", { fill: "currentColor" }, [2]],
      [
        "path",
        {
          d: "\u0000unused-ref:0",
          style: { "--brand-geometry": "\u0000unused-ref:0" },
        },
        [],
      ],
    ],
    variants: {
      default: { viewBox: "0 0 24 24", fill: "none", children: [0, 1] },
      alternate: {
        viewBox: "0 0 32 32",
        fill: "red",
        stroke: "blue",
        children: [2],
      },
    },
  });
  const ref = createRef<SVGSVGElement>();
  const { container, rerender } = render(
    <Icon
      ref={ref}
      variant="alternate"
      viewBox="1 2 3 4"
      fill="green"
      aria-label="custom brand"
    />,
  );

  const svg = container.querySelector("svg");
  expect(svg).toBe(ref.current);
  expect(svg).toHaveAttribute("viewBox", "1 2 3 4");
  expect(svg).toHaveAttribute("fill", "green");
  expect(svg).toHaveAttribute("stroke", "blue");
  expect(svg).toHaveAttribute("aria-label", "custom brand");
  expect(svg?.querySelector("path")).toHaveAttribute(
    "d",
    "M10 20 C30 40 50 60 70 80 C90 100 110 120 130 140 Z",
  );
  expect(
    (svg?.querySelector("path") as SVGPathElement).style.getPropertyValue(
      "--brand-geometry",
    ),
  ).toBe("M10 20 C30 40 50 60 70 80 C90 100 110 120 130 140 Z");

  rerender(<Icon variant="missing" />);
  expect(container.querySelector("svg")).toHaveAttribute(
    "viewBox",
    "0 0 24 24",
  );
  expect(container.querySelector("title#nested-title")).toHaveTextContent(
    "Brand title",
  );
  expect(container.querySelector("g")).toHaveAttribute("fill", "currentColor");
});

it("namespaces fragment IDs and references when the source icon does", () => {
  const Icon = createBrandIconComponent("GradientBrand", {
    namespaceIds: true,
    strings: [],
    stringRefPrefix: "\u0000unused-ref:",
    nodes: [
      ["defs", {}, [1]],
      ["linearGradient", { id: "brand-gradient" }, [2]],
      ["stop", { offset: "0", stopColor: "currentColor" }, []],
      ["path", { fill: "url(#brand-gradient)", d: "M0 0h1" }, []],
    ],
    variants: {
      default: { viewBox: "0 0 1 1", children: [0, 3] },
    },
  });

  const { container } = render(<Icon />);
  const svg = container.querySelector("svg");
  const gradient = container.querySelector("linearGradient");
  const path = container.querySelector("path");

  expect(gradient?.id).toMatch(/^tsvg.+-brand-gradient$/);
  expect(path).toHaveAttribute("fill", `url(#${gradient?.id})`);
  expect(container.querySelector("stop")).toHaveAttribute(
    "stop-color",
    "currentColor",
  );
  expect(svg).toHaveAttribute("viewBox", "0 0 1 1");
});
