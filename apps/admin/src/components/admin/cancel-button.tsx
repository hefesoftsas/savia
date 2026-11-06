import { CircleX } from "lucide-react";
import { Translate, useNavigate } from "ra-core";

import { Button } from "../ui/button";
import { cn } from "@/lib/utils";

/**
 * A button that navigates back to the previous page.
 *
 * Commonly used in form toolbars alongside SaveButton.
 *
 * @see {@link https://marmelab.com/shadcn-admin-kit/docs/cancelbutton/ CancelButton documentation}
 *
 * @example
 * import { CancelButton, SaveButton, SimpleForm } from '@/components/admin';
 *
 * const FormToolbar = () => (
 *   <div className="flex flex-row gap-2 justify-end">
 *     <CancelButton />
 *     <SaveButton />
 *   </div>
 * );
 *
 * const PostEdit = () => (
 *   <Edit>
 *     <SimpleForm toolbar={<FormToolbar />}>
 *       ...
 *     </SimpleForm>
 *   </Edit>
 * );
 */
export function CancelButton({
  className,
  ...props
}: React.ComponentProps<"button">) {
  const navigate = useNavigate();
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={() => navigate(-1)}
      className={cn(
        "cursor-pointer max-sm:size-11 max-sm:p-0 max-sm:has-[>svg]:px-0",
        className,
      )}
      {...props}
    >
      <CircleX aria-hidden="true" />
      <span className="sr-only sm:not-sr-only">
        <Translate i18nKey="ra.action.cancel">Cancel</Translate>
      </span>
    </Button>
  );
}
