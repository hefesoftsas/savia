import * as React from "react";
import { Trash } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { humanize, singularize } from "inflection";
import type { UseDeleteOptions, RedirectionSideEffect } from "ra-core";
import {
  useDeleteWithUndoController,
  useCanAccess,
  useGetRecordRepresentation,
  useResourceTranslation,
  useRecordContext,
  useResourceContext,
  useTranslate,
} from "ra-core";

export type DeleteButtonProps = {
  label?: string;
  iconOnly?: boolean;
  size?: "default" | "sm" | "lg" | "icon";
  onClick?: React.ReactEventHandler<HTMLButtonElement>;
  mutationOptions?: UseDeleteOptions;
  redirect?: RedirectionSideEffect;
  resource?: string;
  successMessage?: string;
  className?: string;
  variant?:
    "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
};

/**
 * A button that deletes a record with undo capability.
 *
 * Renders a destructive button that deletes the current record and shows an undo notification.
 * Automatically redirects after deletion and works with the RecordContext.
 *
 * @see {@link https://marmelab.com/shadcn-admin-kit/docs/deletebutton/ DeleteButton documentation}
 *
 * @example
 * import { DeleteButton, Edit } from '@/components/admin';
 *
 * const PostEdit = () => (
 *     <Edit actions={<DeleteButton />}>
 *         ...
 *     </Edit>
 * );
 */
export const DeleteButton = (props: DeleteButtonProps) => {
  const {
    label: labelProp,
    iconOnly = false,
    onClick,
    size,
    mutationOptions,
    redirect = "list",
    successMessage,
    variant = "outline",
    className = "cursor-pointer hover:bg-destructive/10! text-destructive! border-destructive! focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40",
  } = props;
  const record = useRecordContext(props);
  const resource = useResourceContext(props);
  const { canAccess } = useCanAccess({
    resource,
    action: "delete",
    record,
  });

  const { isPending, handleDelete } = useDeleteWithUndoController({
    record,
    resource,
    redirect,
    onClick,
    mutationOptions,
    successMessage,
  });
  const translate = useTranslate();
  const getRecordRepresentation = useGetRecordRepresentation(resource);
  let recordRepresentation = getRecordRepresentation(record);
  const resourceName = translate(`resources.${resource}.forcedCaseName`, {
    smart_count: 1,
    _: humanize(
      translate(`resources.${resource}.name`, {
        smart_count: 1,
        _: resource ? singularize(resource) : undefined,
      }),
      true,
    ),
  });
  // We don't support React elements for this
  if (React.isValidElement(recordRepresentation)) {
    recordRepresentation = `#${record?.id}`;
  }
  const label = useResourceTranslation({
    resourceI18nKey: `resources.${resource}.action.delete`,
    baseI18nKey: "ra.action.delete",
    options: {
      name: resourceName,
      recordRepresentation,
    },
    userText: labelProp,
  });

  if (!canAccess) return null;

  const button = (
    <Button
      variant={variant}
      type="button"
      onClick={handleDelete}
      disabled={isPending}
      aria-label={typeof label === "string" ? label : undefined}
      size={iconOnly ? "icon" : size}
      className={className}
    >
      <Trash />
      {!iconOnly ? label : null}
    </Button>
  );

  if (!iconOnly || typeof label !== "string") return button;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
};
