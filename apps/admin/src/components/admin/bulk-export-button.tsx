import { Download } from "lucide-react";
import type { RaRecord, UseBulkExportOptions } from "ra-core";
import {
  useBulkExport,
  useGetResourceLabel,
  useResourceContext,
  useResourceTranslation,
} from "ra-core";

import { Button } from "../ui/button";
import { cn } from "@/lib/utils";

/**
 * Export the selected rows
 *
 * To be used inside the <DataTable bulkActionsButtons> prop.
 *
 * @see {@link https://marmelab.com/shadcn-admin-kit/docs/bulkexportbutton/ BulkExportButton documentation}
 *
 * @example
 * import { BulkDeleteButton, BulkExportButton, DataTable, List } from '@/components/admin';
 *
 * export const PostList = () => (
 *   <List>
 *     <DataTable
 *       bulkActionsButtons={
 *         <>
 *           <BulkExportButton />
 *           <BulkDeleteButton />
 *         </>
 *       }
 *     >
 *       ...
 *     </DataTable>
 *   </List>
 * );
 */
export const BulkExportButton = <T extends RaRecord>({
  icon = defaultIcon,
  label: labelProp,
  onClick,
  className,
  ...props
}: BulkExportButtonProps<T>) => {
  const bulkExport = useBulkExport(props);
  const resource = useResourceContext(props);
  const getResourceLabel = useGetResourceLabel();
  const label = useResourceTranslation({
    resourceI18nKey: resource
      ? `resources.${resource}.action.export`
      : undefined,
    baseI18nKey: "ra.action.export",
    options: {
      name: resource ? getResourceLabel(resource, 1) : undefined,
    },
    userText: labelProp,
  });

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    bulkExport();
    onClick?.(event);
  };

  return (
    <Button
      onClick={handleClick}
      role="button"
      variant="outline"
      size="sm"
      className={cn(
        "flex items-center gap-2 h-9",
        icon && "max-sm:size-11 max-sm:p-0 max-sm:has-[>svg]:px-0",
        className,
      )}
      aria-label={typeof label === "string" ? label : undefined}
      title={typeof label === "string" ? label : undefined}
      {...sanitizeRestProps(props)}
    >
      {icon}
      <span className={icon ? "sr-only sm:not-sr-only" : undefined}>
        {label}
      </span>
    </Button>
  );
};

const defaultIcon = <Download className="h-4 w-4" />;

export type BulkExportButtonProps<T extends RaRecord> =
  UseBulkExportOptions<T> & {
    icon?: React.ReactNode;
    label?: string;
  } & React.ComponentProps<typeof Button>;

const sanitizeRestProps = <T extends RaRecord>({
  resource: _resource,
  exporter: _exporter,
  onClick: _onClick,
  label: _label,
  icon: _icon,
  meta: _meta,
  ...rest
}: BulkExportButtonProps<T>) => rest;
