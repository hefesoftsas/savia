import { FilePenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { officeFormat, OFFICE_MAX_SIZE } from "@savia/crm-shared/office";
import { officeEditorUrl } from "../office/office-api";
import { getCrmRuntime } from "./runtime";
export function OfficeEditButton({
  file,
  disabled = false,
}: {
  file: { id: string; name: string; mime: string; size: number };
  disabled?: boolean;
}) {
  const url = officeEditorUrl(getCrmRuntime().apiBasePath, file.id);
  if (
    !url ||
    !officeFormat(file.name, file.mime) ||
    file.size > OFFICE_MAX_SIZE ||
    disabled
  )
    return null;
  return (
    <Button variant="ghost" size="icon" asChild>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={"Editar " + file.name}
        title="Editar documento"
      >
        <FilePenLine size={16} aria-hidden="true" />
      </a>
    </Button>
  );
}
