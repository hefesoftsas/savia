import React from "react";
import { buttonVariants } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Pencil } from "lucide-react";
import type { RaRecord } from "ra-core";
import {
  LinkBase,
  useCreatePath,
  useCanAccess,
  useGetRecordRepresentation,
  useGetResourceLabel,
  useRecordContext,
  useResourceContext,
  useResourceTranslation,
} from "ra-core";

export type EditButtonProps = {
  record?: RaRecord;
  resource?: string;
  label?: string;
  iconOnly?: boolean;
};

/**
 * A button that navigates to the edit page for a record.
 *
 * Works within RecordContext to automatically get the record ID.
 *
 * @see {@link https://marmelab.com/shadcn-admin-kit/docs/editbutton/ EditButton documentation}
 *
 * @example
 * import { DataTable, EditButton } from '@/components/admin';
 *
 * const PostList = () => (
 *   <DataTable>
 *     <DataTable.Col source="title" />
 *     <DataTable.Col source="author" />
 *     <DataTable.Col source="published_at" />
 *     <DataTable.Col>
 *       <EditButton />
 *     </DataTable.Col>
 *   </DataTable>
 * );
 */
export const EditButton = (props: EditButtonProps) => {
  const { label: labelProp, iconOnly = false } = props;
  const resource = useResourceContext(props);
  const record = useRecordContext(props);
  const { canAccess } = useCanAccess({
    resource,
    action: "edit",
    record,
  });
  const createPath = useCreatePath();
  const getResourceLabel = useGetResourceLabel();
  const getRecordRepresentation = useGetRecordRepresentation(resource);
  const recordRepresentationValue = getRecordRepresentation(record);
  const recordRepresentation =
    typeof recordRepresentationValue === "string"
      ? recordRepresentationValue
      : recordRepresentationValue?.toString();
  const href = createPath({
    resource,
    type: "edit",
    id: record?.id,
  });
  const label = useResourceTranslation({
    resourceI18nKey: resource ? `resources.${resource}.action.edit` : undefined,
    baseI18nKey: "ra.action.edit",
    options: {
      name: resource ? getResourceLabel(resource, 1) : undefined,
      recordRepresentation,
    },
    userText: labelProp,
  });
  if (!canAccess) return null;
  const button = (
    <LinkBase
      className={buttonVariants({
        variant: "outline",
        size: iconOnly ? "icon" : "default",
      })}
      to={href}
      onClick={stopPropagation}
      aria-label={typeof label === "string" ? label : undefined}
    >
      <Pencil />
      {!iconOnly ? label : null}
    </LinkBase>
  );

  if (!iconOnly || typeof label !== "string") return button;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
};

// useful to prevent click bubbling in a datagrid with rowClick
const stopPropagation = (e: React.MouseEvent) => e.stopPropagation();
