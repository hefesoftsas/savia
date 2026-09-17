import type { ComponentProps } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { BarChart3, Table as TableIcon, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

type TablePresentation = {
  title: string;
  description?: string;
  kind: "table";
  columns: string[];
  rows: Array<Array<string | number | null>>;
};

type ChartPresentation = {
  title: string;
  description?: string;
  kind: "bar" | "line";
  valueLabel: string;
  series: Array<{ label: string; value: number }>;
};

export type AssistantPresentation = TablePresentation | ChartPresentation;

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function textValue(value: unknown, maximumLength: number): string | null {
  return typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maximumLength
    ? value.trim()
    : null;
}

function cellValue(value: unknown): string | number | null {
  if (value === null) return null;
  if (typeof value === "string" && value.length <= 160) return value;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function tablePresentation(
  value: Record<string, unknown>,
): TablePresentation | null {
  const visualization = objectValue(value.visualization);
  const title = textValue(value.title, 120);
  if (!visualization || !title || visualization.kind !== "table") return null;

  const columns = Array.isArray(visualization.columns)
    ? visualization.columns.map((column) => textValue(column, 80))
    : [];
  const rows = Array.isArray(visualization.rows) ? visualization.rows : [];
  if (
    columns.length === 0 ||
    columns.length > 6 ||
    columns.some((column) => column === null) ||
    rows.length === 0 ||
    rows.length > 50
  ) {
    return null;
  }

  const parsedRows = rows.map((row) => {
    if (!Array.isArray(row) || row.length !== columns.length) return null;
    const parsed = row.map(cellValue);
    return parsed.some((cell, index) => row[index] !== null && cell === null)
      ? null
      : parsed;
  });
  if (parsedRows.some((row) => row === null)) return null;

  const description =
    value.description === undefined
      ? undefined
      : textValue(value.description, 240);
  if (description === null) return null;

  return {
    title,
    description,
    kind: "table",
    columns: columns as string[],
    rows: parsedRows as Array<Array<string | number | null>>,
  };
}

function chartPresentation(
  value: Record<string, unknown>,
): ChartPresentation | null {
  const visualization = objectValue(value.visualization);
  const title = textValue(value.title, 120);
  if (
    !visualization ||
    !title ||
    (visualization.kind !== "bar" && visualization.kind !== "line")
  ) {
    return null;
  }

  const valueLabel = textValue(visualization.valueLabel, 80);
  const series = Array.isArray(visualization.series)
    ? visualization.series
    : [];
  if (!valueLabel || series.length === 0 || series.length > 12) return null;

  const parsedSeries = series.map((point) => {
    const item = objectValue(point);
    const label = item ? textValue(item.label, 80) : null;
    return label &&
      item &&
      typeof item.value === "number" &&
      Number.isFinite(item.value)
      ? { label, value: item.value }
      : null;
  });
  if (parsedSeries.some((point) => point === null)) return null;

  const description =
    value.description === undefined
      ? undefined
      : textValue(value.description, 240);
  if (description === null) return null;

  return {
    title,
    description,
    kind: visualization.kind,
    valueLabel,
    series: parsedSeries as Array<{ label: string; value: number }>,
  };
}

export function presentationFrom(value: unknown): AssistantPresentation | null {
  const record = objectValue(value);
  if (!record) return null;
  const direct = tablePresentation(record) ?? chartPresentation(record);
  if (direct) return direct;
  if (record.output && typeof record.output === "object") {
    const fromOutput = presentationFrom(record.output);
    if (fromOutput) return fromOutput;
  }
  if (record.input && typeof record.input === "object") {
    const fromInput = presentationFrom(record.input);
    if (fromInput) return fromInput;
  }
  return null;
}

function formatCell(value: string | number | null): string {
  return value === null
    ? "—"
    : typeof value === "number"
      ? new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 }).format(
          value,
        )
      : value;
}

function MarkdownTable({
  className,
  node: _node,
  ...props
}: ComponentProps<"table"> & { node?: unknown }) {
  return (
    <div className="my-3.5 w-full overflow-x-auto rounded-xl border border-border/70 bg-card/40 shadow-2xs">
      <table
        className={cn(
          "w-full min-w-max border-collapse text-left text-sm",
          className,
        )}
        {...props}
      />
    </div>
  );
}

export function AssistantMarkdown({ text }: { text: string }) {
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <p className="mb-2.5 leading-relaxed last:mb-0">{children}</p>,
        strong: ({ children }) => (
          <strong className="font-semibold text-foreground">{children}</strong>
        ),
        ul: ({ children }) => (
          <ul className="my-2.5 list-disc space-y-1.5 pl-5">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="my-2.5 list-decimal space-y-1.5 pl-5">{children}</ol>
        ),
        a: ({ children, href }) => (
          <a
            className="font-medium text-primary underline underline-offset-4 transition-opacity hover:opacity-80"
            href={href}
            rel="noreferrer"
            target="_blank"
          >
            {children}
          </a>
        ),
        table: MarkdownTable,
        thead: ({ children }) => (
          <thead className="border-b border-border/80 bg-muted/60 text-xs font-semibold uppercase tracking-wider text-foreground">
            {children}
          </thead>
        ),
        th: ({ children }) => (
          <th className="border-b px-3.5 py-2.5 text-xs font-semibold text-foreground">
            {children}
          </th>
        ),
        td: ({ children }) => (
          <td className="border-b border-border/40 px-3.5 py-2 align-middle text-sm text-foreground/90 last:border-b-0">
            {children}
          </td>
        ),
        code: ({ children }) => (
          <code className="rounded-md border border-border/50 bg-muted/80 px-1.5 py-0.5 font-mono text-xs text-primary">
            {children}
          </code>
        ),
      }}
    >
      {text}
    </Markdown>
  );
}

function chartDescription(presentation: ChartPresentation): string {
  const values = presentation.series
    .map(({ label, value }) => `${label} ${formatCell(value)}`)
    .join(", ");
  return `${presentation.title}. ${presentation.valueLabel}: ${values}.`;
}

function ChartGraphic({ presentation }: { presentation: ChartPresentation }) {
  const { kind, series } = presentation;
  const values = series.map((point) => point.value);
  const minimum = Math.min(0, ...values);
  const maximum = Math.max(0, ...values);
  const range = maximum - minimum || 1;
  const baseline = 112 - ((0 - minimum) / range) * 96;
  const x = (index: number) => (index / Math.max(1, series.length - 1)) * 300;
  const y = (value: number) => 112 - ((value - minimum) / range) * 96;
  const points = series
    .map((point, index) => `${x(index)},${y(point.value)}`)
    .join(" ");

  return (
    <svg
      aria-label={chartDescription(presentation)}
      className="h-36 w-full overflow-visible"
      preserveAspectRatio="none"
      role="img"
      viewBox="0 0 300 144"
    >
      <line
        className="stroke-border/50"
        x1="0"
        x2="300"
        y1={baseline}
        y2={baseline}
      />
      {kind === "line" ? (
        <>
          <polyline
            className="fill-none stroke-primary"
            points={points}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="3"
          />
          {series.map((point, index) => (
            <circle
              className="fill-primary"
              cx={x(index)}
              cy={y(point.value)}
              key={`${point.label}-${index}`}
              r="3"
            />
          ))}
        </>
      ) : (
        series.map((point, index) => {
          const width = Math.min(28, 220 / series.length);
          const top = Math.min(y(point.value), baseline);
          return (
            <g key={`${point.label}-${index}`}>
              <rect
                className="fill-primary transition-all hover:opacity-85"
                height={Math.abs(baseline - y(point.value))}
                rx="3"
                width={width}
                x={x(index) - width / 2}
                y={top}
              />
              <text
                className="fill-foreground text-[8px] font-semibold"
                textAnchor="middle"
                x={x(index)}
                y={Math.max(10, top - 3)}
              >
                {formatCell(point.value)}
              </text>
            </g>
          );
        })
      )}
      {series.map((point, index) => (
        <text
          className="fill-muted-foreground text-[9px]"
          key={`${point.label}-${index}`}
          textAnchor="middle"
          x={x(index)}
          y="137"
        >
          {point.label}
        </text>
      ))}
    </svg>
  );
}

export function AssistantPresentationCard({
  presentation,
}: {
  presentation: AssistantPresentation;
}) {
  const { title, description } = presentation;
  return (
    <section
      className="mt-3.5 overflow-hidden rounded-xl border border-border/70 bg-card/60 shadow-2xs backdrop-blur-xs"
      data-testid="assistant-presentation"
    >
      <header className="flex items-center justify-between border-b border-border/60 bg-muted/30 px-3.5 py-2.5">
        <div className="flex items-center gap-2">
          {presentation.kind === "table" ? (
            <TableIcon className="size-4 shrink-0 text-primary" />
          ) : presentation.kind === "line" ? (
            <TrendingUp className="size-4 shrink-0 text-primary" />
          ) : (
            <BarChart3 className="size-4 shrink-0 text-primary" />
          )}
          <div>
            <h3 className="text-sm font-semibold tracking-tight text-foreground">
              {title}
            </h3>
            {description ? (
              <p className="text-[11px] text-muted-foreground">{description}</p>
            ) : null}
          </div>
        </div>
        <span className="rounded-md border border-border/40 bg-background/60 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
          {presentation.kind === "table"
            ? `${presentation.rows.length} ${presentation.rows.length === 1 ? "fila" : "filas"}`
            : presentation.kind === "bar"
              ? "Gráfico de barras"
              : "Tendencia"}
        </span>
      </header>
      {presentation.kind === "table" ? (
        <div className="overflow-x-auto">
          <table
            aria-label={title}
            className="w-full min-w-max text-left text-sm"
          >
            <thead className="border-b border-border/60 bg-muted/40 text-xs font-medium text-muted-foreground">
              <tr>
                {presentation.columns.map((column) => (
                  <th
                    className="px-3.5 py-2 font-medium"
                    key={column}
                    scope="col"
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {presentation.rows.map((row, rowIndex) => (
                <tr
                  className="border-b border-border/30 transition-colors last:border-b-0 hover:bg-muted/20"
                  key={rowIndex}
                >
                  {row.map((cell, cellIndex) => (
                    <td
                      className={cn(
                        "px-3.5 py-2",
                        typeof cell === "number" && "text-right font-mono",
                      )}
                      key={`${rowIndex}-${cellIndex}`}
                    >
                      {formatCell(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <figure className="px-3 pt-3 pb-2">
          <ChartGraphic presentation={presentation} />
          <figcaption className="sr-only">
            {chartDescription(presentation)}
          </figcaption>
        </figure>
      )}
    </section>
  );
}

