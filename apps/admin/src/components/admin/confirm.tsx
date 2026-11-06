import { CheckCircle, Trash2, LoaderCircle } from "lucide-react";
import { useTranslate } from "ra-core";
import * as React from "react";
import type { ComponentType, MouseEventHandler } from "react";
import { useCallback } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Generic confirmation dialog component for destructive actions.
 *
 * Displays a dialog with customizable title, content, and action buttons.
 * Used internally for delete operations and other confirmations.
 * Supports custom icons, button labels, and loading states.
 *
 * @see {@link https://marmelab.com/shadcn-admin-kit/docs/confirm Confirm documentation}
 *
 * @example
 * import { useState } from "react";
 * import { useDelete, useRecordContext, useResourceContext, useRedirect } from "ra-core";
 * import { Button } from "@/components/ui/button";
 * import { Confirm } from "@/components/admin/confirm";
 *
 * const DeleteButton = () => {
 *   const resource = useResourceContext();
 *   const record = useRecordContext();
 *   const [isOpen, setIsOpen] = useState(false);
 *   const [deleteOne, { isPending }] = useDelete();
 *   const redirect = useRedirect();
 *
 *   const handleDelete = () => {
 *     deleteOne(
 *       resource,
 *       { id: record?.id, previousData: record },
 *       {
 *         onSuccess: () => {
 *           setIsOpen(false);
 *           redirect("list", resource);
 *         },
 *       },
 *     );
 *   };
 *
 *   return (
 *     <>
 *       <Button variant="destructive" onClick={() => setIsOpen(true)}>
 *         Delete
 *       </Button>
 *       <Confirm
 *         isOpen={isOpen}
 *         title="Are you sure you want to delete this element?"
 *         content="This action cannot be undone."
 *         onConfirm={handleDelete}
 *         onClose={() => setIsOpen(false)}
 *         loading={isPending}
 *       />
 *     </>
 *   );
 * };
 */
export const Confirm = (props: ConfirmProps) => {
  const {
    className,
    isOpen = false,
    loading,
    title,
    content,
    cancel = "ra.action.cancel",
    confirm = "ra.action.confirm",
    confirmColor = "primary",
    ConfirmIcon = confirmColor === "warning" ? Trash2 : CheckCircle,
    CancelIcon,
    onClose,
    onConfirm,
    translateOptions = {},
    titleTranslateOptions = translateOptions,
    contentTranslateOptions = translateOptions,
    ...rest
  } = props;

  const translate = useTranslate();

  const handleConfirm = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      onConfirm(e);
    },
    [onConfirm],
  );

  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
  }, []);

  return (
    <Dialog
      open={isOpen}
      onOpenChange={() => {
        if (!loading) onClose();
      }}
    >
      <DialogContent
        className={`gap-6 sm:max-w-md ${className ?? ""}`}
        onClick={handleClick}
        aria-busy={loading}
        {...rest}
      >
        <DialogHeader>
          <DialogTitle>
            {typeof title === "string"
              ? translate(title, { _: title, ...titleTranslateOptions })
              : title}
          </DialogTitle>
          {typeof content === "string" ? (
            <DialogDescription className="leading-relaxed break-words">
              {translate(content, {
                _: content,
                ...contentTranslateOptions,
              })}
            </DialogDescription>
          ) : (
            content
          )}
        </DialogHeader>
        <DialogFooter className="gap-3">
          <Button
            variant="outline"
            disabled={loading}
            onClick={onClose}
            className="min-h-11 gap-2"
          >
            {CancelIcon ? <CancelIcon className="h-4 w-4" /> : null}
            {translate(cancel, { _: cancel })}
          </Button>
          <Button
            disabled={loading}
            onClick={handleConfirm}
            className="min-h-11 gap-2"
            variant={confirmColor === "warning" ? "destructive" : "default"}
          >
            {loading ? (
              <LoaderCircle
                className="h-4 w-4 animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            ) : (
              <ConfirmIcon className="h-4 w-4" />
            )}
            {translate(confirm, { _: confirm })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export interface ConfirmProps {
  cancel?: string;
  className?: string;
  confirm?: string;
  confirmColor?: "primary" | "warning";
  ConfirmIcon?: ComponentType<{ className?: string }>;
  CancelIcon?: ComponentType<{ className?: string }>;
  content?: React.ReactNode;
  isOpen?: boolean;
  loading?: boolean;
  onClose: () => void;
  onConfirm: MouseEventHandler;
  title: React.ReactNode;
  /**
   * @deprecated use `titleTranslateOptions` and `contentTranslateOptions` instead
   */
  translateOptions?: object;
  titleTranslateOptions?: object;
  contentTranslateOptions?: object;
}
