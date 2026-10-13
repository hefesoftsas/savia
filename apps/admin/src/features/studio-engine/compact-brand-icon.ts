import {
  createElement,
  forwardRef,
  useId,
  type ForwardRefExoticComponent,
  type RefAttributes,
  type SVGProps,
} from "react";

type CompactNode = [
  type: string,
  props: Record<string, unknown>,
  children: Array<number | string>,
];

type CompactVariant = {
  viewBox?: string;
  fill?: string;
  stroke?: string;
  children: Array<number | string>;
};

export type CompactBrandIconConfig = {
  nodes: CompactNode[];
  strings: string[];
  stringRefPrefix: string;
  variants: Record<string, CompactVariant>;
  namespaceIds: boolean;
};

export type CompactBrandIconProps = SVGProps<SVGSVGElement> & {
  variant?: string;
};

export function createBrandIconComponent(
  displayName: string,
  config: CompactBrandIconConfig,
): ForwardRefExoticComponent<
  CompactBrandIconProps & RefAttributes<SVGSVGElement>
> {
  const component = forwardRef<SVGSVGElement, CompactBrandIconProps>(
    function CompactBrandIcon({ variant = "default", viewBox, ...props }, ref) {
      const prefix = config.namespaceIds
        ? `tsvg${useId().replace(/[^a-zA-Z0-9]/g, "")}-`
        : "";
      const selected = config.variants[variant] || config.variants.default;
      if (!selected) return null;

      function renderChild(
        child: number | string,
      ): string | ReturnType<typeof createElement> | null {
        if (typeof child === "string") return decodeString(child);
        const node = config.nodes[child];
        if (!node) return null;
        const children = node[2].map(renderChild);
        const props = decodeValue(node[1]) as Record<string, unknown>;
        return createElement(
          node[0],
          config.namespaceIds ? namespaceProps(props, prefix) : props,
          ...children,
        );
      }

      return createElement(
        "svg",
        Object.assign(
          {
            ref,
            viewBox: viewBox || selected.viewBox,
            fill: selected.fill,
            stroke: selected.stroke,
            xmlns: "http://www.w3.org/2000/svg",
          },
          props,
        ),
        ...selected.children.map(renderChild),
      );
    },
  );
  component.displayName = displayName;
  return component;

  function decodeString(value: string): string {
    if (!value.startsWith(config.stringRefPrefix)) return value;
    const suffix = value.slice(config.stringRefPrefix.length);
    if (!/^\d+$/.test(suffix)) return value;
    return config.strings[Number(suffix)] ?? value;
  }

  function decodeValue(value: unknown): unknown {
    if (typeof value === "string") return decodeString(value);
    if (Array.isArray(value)) return value.map(decodeValue);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([key, child]) => [key, decodeValue(child)]),
      );
    }
    return value;
  }
}

function namespaceProps(
  props: Record<string, unknown>,
  prefix: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key in props) {
    const value = props[key];
    if (key === "id") out[key] = prefix + value;
    else if (
      key === "href" &&
      typeof value === "string" &&
      value.charCodeAt(0) === 35
    ) {
      out[key] = `#${prefix}${value.slice(1)}`;
    } else if (typeof value === "string") {
      out[key] = value.replace(
        /url\(#([^)]+)\)/g,
        (_match, id: string) => `url(#${prefix}${id})`,
      );
    } else if (value && typeof value === "object") {
      const style: Record<string, unknown> = {};
      for (const styleKey in value) {
        const styleValue = (value as Record<string, unknown>)[styleKey];
        style[styleKey] =
          typeof styleValue === "string"
            ? styleValue.replace(
                /url\(#([^)]+)\)/g,
                (_match, id: string) => `url(#${prefix}${id})`,
              )
            : styleValue;
      }
      out[key] = style;
    } else out[key] = value;
  }
  return out;
}
