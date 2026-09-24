import { pluginIntlLocale, type PluginLocale, type PluginMessageParams } from "@savia/studio-shared/plugin-localization";
import { insuranceMessage } from "../messages";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { VehicleInfo } from "./quote-results";
import { formatCop, type UnifiedComparisonQuote } from "./unified-quote-model";

const pageSize: [number, number] = [841.89, 595.28];
const margin = 38;
const ink = rgb(0.05, 0.11, 0.18);
const muted = rgb(0.31, 0.39, 0.48);
const emerald = rgb(0, 0.49, 0.35);
const paleEmerald = rgb(0.91, 0.97, 0.94);
const line = rgb(0.82, 0.87, 0.86);

const coverages: Array<[keyof UnifiedComparisonQuote["coverages"], string]> = [
  ["rce", "Responsabilidad civil"],
  ["partialLossDeductible", "Deducible pérdida parcial"],
  ["totalLossDeductible", "Deducible pérdida total"],
  ["replacementCar", "Auto de reemplazo"],
  ["craneAssistance", "Grúa y asistencia"],
  ["designatedDriver", "Conductor elegido"],
  ["medicalExpenses", "Amparo patrimonial y gastos médicos"],
  ["legalAssistance", "Asistencia jurídica"],
  ["workshop", "Talleres"],
];

export type QuoteComparisonPdfInput = {
  quotes: readonly UnifiedComparisonQuote[];
  quoteReference?: string;
  vehicleInfo?: VehicleInfo;
  createdAt?: Date;
  locale?: PluginLocale;
};

function pdfText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[·•]/g, " - ")
    .replace(/[^\x20-\x7e]/g, "-");
}

function money(amount: number, locale: PluginLocale): string {
  return pdfText(formatCop(amount, locale).replace(/\u00a0/g, " "));
}

function ellipsis(font: PDFFont, value: string, size: number, maxWidth: number): string {
  const clean = pdfText(value);
  if (font.widthOfTextAtSize(clean, size) <= maxWidth) return clean;
  let result = clean;
  while (result && font.widthOfTextAtSize(`${result}...`, size) > maxWidth) result = result.slice(0, -1);
  return `${result.trimEnd()}...`;
}

function wrapped(font: PDFFont, value: string, size: number, maxWidth: number, maxLines = 2): string[] {
  const words = pdfText(value).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let lineValue = "";

  for (const word of words) {
    const next = lineValue ? `${lineValue} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= maxWidth) {
      lineValue = next;
      continue;
    }
    if (lineValue) lines.push(lineValue);
    lineValue = word;
    if (lines.length === maxLines - 1) break;
  }
  if (lineValue && lines.length < maxLines) lines.push(lineValue);
  if (words.join(" ") !== lines.join(" ")) {
    const last = lines.length - 1;
    lines[last] = ellipsis(font, lines[last] ?? "", size, maxWidth);
  }
  return lines.length ? lines : ["-"];
}

function drawLines(
  page: PDFPage,
  font: PDFFont,
  lines: readonly string[],
  x: number,
  y: number,
  size: number,
  color: ReturnType<typeof rgb>,
) {
  lines.forEach((value, index) => page.drawText(value, { color, font, size, x, y: y - index * (size + 1.5) }));
}

export async function buildQuoteComparisonPdf(input: QuoteComparisonPdfInput): Promise<Uint8Array> {
  const locale = input.locale ?? "es";
  const t = (message: string, params?: PluginMessageParams) => insuranceMessage(message,locale,params);
  // Respeta el orden de selección y muestra TODAS las elegidas (máx. 4 por página).
  const quotes = input.quotes.slice(0, 4);
  if (!quotes.length) throw new Error(t("Selecciona al menos una oferta para exportar."));

  const document = await PDFDocument.create();
  document.setTitle(t("Comparador de cotizaciones Savia"));
  document.setAuthor("Savia");
  document.setSubject(t("Comparación de ofertas de seguro"));

  const page = document.addPage(pageSize);
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const { height } = page.getSize();

  page.drawRectangle({ color: emerald, height: 7, width: page.getWidth(), x: 0, y: height - 7 });
  page.drawText(t("COMPARADOR DE COTIZACIONES"), { color: ink, font: bold, size: 19, x: margin, y: height - 45 });
  page.drawText(t("Savia · seguros para automóviles"), { color: emerald, font: regular, size: 9, x: margin, y: height - 60 });

  const metaParts = [
    input.quoteReference ? t("Referencia: %{p0}", {p0: input.quoteReference}) : null,
    input.vehicleInfo?.plate ? t("Placa: %{p0}", {p0: input.vehicleInfo.plate}) : null,
    input.vehicleInfo?.declaredValue ? t("Valor asegurado: %{p0}", {p0: money(input.vehicleInfo.declaredValue, locale)}) : null,
  ].filter(Boolean) as string[];
  const date = new Intl.DateTimeFormat(pluginIntlLocale(locale), { dateStyle: "medium" }).format(input.createdAt ?? new Date());
  const metaLine = pdfText(
    [...metaParts, t("Generado: %{p0}", {p0: date}), t("Ofertas: %{p0} de 4", {p0: quotes.length})].join("  |  "),
  );
  const metaFontSize = 8.2;
  page.drawText(ellipsis(regular, metaLine, metaFontSize, page.getWidth() - margin * 2), {
    color: muted,
    font: regular,
    size: metaFontSize,
    x: margin,
    y: height - 82,
  });

  const top = height - 105;
  const labelWidth = 150;
  const tableWidth = page.getWidth() - margin * 2;
  const planWidth = (tableWidth - labelWidth) / quotes.length;
  const headerHeight = 58;
  const rowHeight = 37;

  page.drawRectangle({ color: paleEmerald, height: headerHeight, width: tableWidth, x: margin, y: top - headerHeight });
  page.drawText(t("COBERTURA  ·  %{p0} DE 4 OFERTAS", {p0: quotes.length}), { color: emerald, font: bold, size: 8, x: margin + 10, y: top - 22 });
  quotes.forEach((quote, index) => {
    const x = margin + labelWidth + index * planWidth + 9;
    drawLines(page, bold, wrapped(bold, `${index + 1} - ${quote.provider}`, 8.4, planWidth - 18), x, top - 17, 8.4, ink);
    drawLines(page, regular, wrapped(regular, quote.productName, 7.6, planWidth - 18), x, top - 28, 7.6, muted);
    page.drawText(quote.premium > 0 ? money(quote.premium, locale) : t("Consultar"), {
      color: emerald,
      font: bold,
      size: 8.6,
      x,
      y: top - 46,
    });
  });

  coverages.forEach(([key, label], rowIndex) => {
    const rowTop = top - headerHeight - rowIndex * rowHeight;
    const rowBottom = rowTop - rowHeight;
    if (rowIndex % 2 === 0) {
      page.drawRectangle({ color: rgb(0.975, 0.985, 0.982), height: rowHeight, width: tableWidth, x: margin, y: rowBottom });
    }
    page.drawLine({ color: line, end: { x: margin + tableWidth, y: rowBottom }, start: { x: margin, y: rowBottom }, thickness: 0.55 });
    drawLines(page, bold, wrapped(bold, t(label), 7.4, labelWidth - 16), margin + 8, rowTop - 13, 7.4, ink);
    quotes.forEach((quote, index) => {
      const x = margin + labelWidth + index * planWidth + 9;
      drawLines(page, regular, wrapped(regular, quote.coverages[key], 7.2, planWidth - 18), x, rowTop - 12, 7.2, ink);
    });
  });

  const footerY = top - headerHeight - coverages.length * rowHeight - 25;
  page.drawText(t("Valores informativos sujetos a las condiciones oficiales de cada aseguradora."), {
    color: muted,
    font: regular,
    size: 7.2,
    x: margin,
    y: footerY,
  });
  page.drawText(t("Ofertas comparadas: %{p0} de 4", {p0: quotes.length}), { color: muted, font: regular, size: 7.2, x: page.getWidth() - margin - 118, y: footerY });

  return document.save();
}

export async function downloadQuoteComparisonPdf(input: QuoteComparisonPdfInput): Promise<void> {
  const bytes = await buildQuoteComparisonPdf(input);
  const blob = new Blob([Uint8Array.from(bytes)], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const reference = (input.quoteReference ?? "cotizaciones").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  anchor.download = `comparador-${reference}.pdf`;
  anchor.href = url;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
