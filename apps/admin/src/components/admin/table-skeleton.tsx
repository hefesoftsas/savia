import { useMessages } from "@/i18n/core";
import { settingsMessages } from "@/i18n/locales/settings";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export interface TableSkeletonColumn {
  width?: string;
  className?: string;
}

export interface TableSkeletonProps {
  columns?: number | TableSkeletonColumn[];
  rows?: number;
  hasCheckbox?: boolean;
  showHeader?: boolean;
  className?: string;
  ariaLabel?: string;
}

const DEFAULT_WIDTHS = ["w-24", "w-40", "w-28", "w-20", "w-32"];

export function TableSkeleton({
  columns = 4,
  rows = 5,
  hasCheckbox = false,
  showHeader = true,
  className,
  ariaLabel: configuredAriaLabel,
}: TableSkeletonProps) {
  const t = useMessages(settingsMessages);
  const ariaLabel = configuredAriaLabel ?? t("Cargando datos…");
  const columnDefs: TableSkeletonColumn[] =
    typeof columns === "number"
      ? Array.from({ length: columns }, (_, i) => ({
          width: DEFAULT_WIDTHS[i % DEFAULT_WIDTHS.length],
        }))
      : columns;

  return (
    <div
      className={cn("rounded-md border bg-card overflow-hidden", className)}
      role="status"
      aria-label={ariaLabel}
      aria-live="polite"
    >
      <Table>
        {showHeader ? (
          <TableHeader>
            <TableRow>
              {hasCheckbox ? (
                <TableHead className="w-8">
                  <Skeleton className="size-4" />
                </TableHead>
              ) : null}
              {columnDefs.map((col, i) => (
                <TableHead key={i} className={col.className}>
                  <Skeleton className={cn("h-4 my-2", col.width ?? "w-24")} />
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
        ) : null}
        <TableBody>
          {Array.from({ length: rows }, (_, rowIndex) => (
            <TableRow key={rowIndex}>
              {hasCheckbox ? (
                <TableCell className="w-8">
                  <Skeleton className="size-4" />
                </TableCell>
              ) : null}
              {columnDefs.map((col, colIndex) => (
                <TableCell
                  key={colIndex}
                  className={cn("py-3.5", col.className)}
                >
                  <Skeleton
                    className={cn(
                      "h-4",
                      col.width ??
                        DEFAULT_WIDTHS[colIndex % DEFAULT_WIDTHS.length],
                    )}
                  />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
