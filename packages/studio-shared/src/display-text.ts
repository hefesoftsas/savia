import { z } from "zod";
import {
  renderFormHtmlTemplate,
  type FormHtmlTemplateScope,
} from "./form-html";

export const DISPLAY_TEXT_TYPE = "DisplayText" as const;

export const displayTextVariants = [
  "title",
  "subtitle",
  "span",
  "caption",
  "help",
] as const;

export type DisplayTextVariant = (typeof displayTextVariants)[number];

export const displayTextVariantLabels: Record<DisplayTextVariant, string> = {
  title: "Título",
  subtitle: "Subtítulo",
  span: "Texto",
  caption: "Leyenda",
  help: "Ayuda",
};

export const displayTextConfigSchema = z
  .object({
    variant: z.enum(displayTextVariants).default("span"),
    content: z.string().max(5000).default(""),
    translations: z
      .object({
        es: z.string().max(5000).optional(),
        en: z.string().max(5000).optional(),
        pt: z.string().max(5000).optional(),
      })
      .strict()
      .optional(),
    align: z.enum(["left", "center", "right"]).optional(),
  })
  .strict();

export type DisplayTextConfig = z.infer<typeof displayTextConfigSchema>;

export function resolveDisplayText(
  config: Record<string, unknown> | undefined,
): DisplayTextConfig | null {
  if (!config?.displayText) return null;
  const parsed = displayTextConfigSchema.safeParse(config.displayText);
  return parsed.success ? parsed.data : null;
}

export function renderDisplayTextContent(
  content: string,
  scope: FormHtmlTemplateScope,
) {
  return renderFormHtmlTemplate(content, scope);
}
