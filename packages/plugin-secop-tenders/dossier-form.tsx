import type { ReactNode } from "react";
/** Plugin iframes block native form navigation; invoke the callback directly. */
export function DossierForm({
  onSubmit,
  children,
}: {
  onSubmit: (form: HTMLFormElement) => void;
  children: ReactNode;
}) {
  const submit = (form: HTMLFormElement) => {
    if (form.reportValidity()) onSubmit(form);
  };
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit(event.currentTarget);
      }}
      onClick={(event) => {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
          "button[data-dossier-submit]",
        );
        if (button?.form === event.currentTarget) {
          event.preventDefault();
          submit(event.currentTarget);
        }
      }}
      onKeyDown={(event) => {
        if (
          event.key === "Enter" &&
          (event.target as HTMLElement).tagName === "INPUT"
        ) {
          event.preventDefault();
          submit(event.currentTarget);
        }
      }}
    >
      {children}
    </form>
  );
}
