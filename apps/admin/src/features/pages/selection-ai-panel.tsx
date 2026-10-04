import { useEffect, useId, useRef, useState } from "react";
import type { ApiClient } from "@/api/api-client";
import {
  VirtualEmployeesClient,
  type VirtualEmployee,
} from "@/api/virtual-employees-client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useMessages } from "@/i18n/core";
import { selectionAIMessages } from "./selection-ai-messages";
import { requestSelectionAI } from "./selection-ai-request";

export function SelectionAIPanel({
  api,
  text,
  onClose,
  onApply,
  onRestoreFocus,
}: {
  api: ApiClient;
  text: string;
  onClose(): void;
  onApply(text: string, mode: "replace" | "insert"): boolean;
  onRestoreFocus(): void;
}) {
  const t = useMessages(selectionAIMessages);
  const id = useId();
  const [employees, setEmployees] = useState<VirtualEmployee[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [employeesError, setEmployeesError] = useState(false);
  const [employeesLoading, setEmployeesLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [instruction, setInstruction] = useState("");
  const [response, setResponse] = useState("");
  const [running, setRunning] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState<
    "Request failed" | "Selection changed" | "Copy failed" | null
  >(null);
  const [copied, setCopied] = useState(false);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    let active = true;
    setEmployeesLoading(true);
    setEmployeesError(false);
    new VirtualEmployeesClient(api)
      .list()
      .then((items) => {
        if (active)
          setEmployees(
            items.filter((employee) => employee.status === "active"),
          );
      })
      .catch(() => {
        if (active) setEmployeesError(true);
      })
      .finally(() => {
        if (active) setEmployeesLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api, retry]);
  useEffect(
    () => () => {
      controller.current?.abort();
      controller.current = null;
    },
    [],
  );

  function cancel() {
    controller.current?.abort();
    controller.current = null;
    setRunning(false);
    setResponse("");
    setComplete(false);
  }
  async function generate() {
    if (controller.current || !instruction.trim()) return;
    const current = new AbortController();
    controller.current = current;
    setRunning(true);
    setComplete(false);
    setResponse("");
    setError(null);
    setCopied(false);
    try {
      const result = await requestSelectionAI(api, {
        text,
        instruction: instruction.trim(),
        employeeId: employeeId || undefined,
        signal: current.signal,
        onText: (value) => {
          if (controller.current === current) setResponse(value);
        },
      });
      if (controller.current === current) {
        setResponse(result);
        setComplete(true);
      }
    } catch {
      if (controller.current === current && !current.signal.aborted) {
        setError("Request failed");
        setResponse("");
      }
    } finally {
      if (controller.current === current) {
        controller.current = null;
        setRunning(false);
      }
    }
  }
  function apply(mode: "replace" | "insert") {
    if (!complete || running) return;
    if (onApply(response, mode)) onClose();
    else setError("Selection changed");
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(response);
      setCopied(true);
      setError(null);
    } catch {
      setError("Copy failed");
    }
  }

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        className="w-full gap-0 overflow-y-auto sm:max-w-lg"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onRestoreFocus();
        }}
      >
        <SheetHeader className="pr-12">
          <SheetTitle>{t("Ask AI")}</SheetTitle>
          <SheetDescription>{t("Description")}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-5 p-4 pt-2">
          <div className="space-y-2">
            <h3 className="text-sm font-medium">{t("Selected text")}</h3>
            <blockquote className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-sm">
              {text}
            </blockquote>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-assistant`}>{t("Assistant")}</Label>
            <select
              id={`${id}-assistant`}
              className="border-input bg-background focus-visible:ring-ring h-10 w-full min-w-0 rounded-md border px-3 text-sm focus-visible:ring-2"
              disabled={running || employeesLoading}
              value={employeeId}
              onChange={(event) => {
                setEmployeeId(event.target.value);
              }}
            >
              <option value="">{t("Connected model")}</option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.name} (@{employee.handle})
                </option>
              ))}
            </select>
            {employeesError && (
              <div className="text-muted-foreground text-sm">
                <p role="status">{t("Employees failed")}</p>
                <Button
                  variant="link"
                  className="h-auto p-0"
                  onClick={() => setRetry((value) => value + 1)}
                >
                  {t("Retry")}
                </Button>
              </div>
            )}
          </div>
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void generate();
            }}
          >
            <Label htmlFor={`${id}-instruction`}>{t("Instruction")}</Label>
            <Textarea
              id={`${id}-instruction`}
              placeholder={t("Placeholder")}
              rows={3}
              value={instruction}
              disabled={running}
              onChange={(event) => setInstruction(event.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              {(["Summarize", "Improve", "Translate", "Explain"] as const).map(
                (action) => (
                  <Button
                    key={action}
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={running}
                    onClick={() => setInstruction(t(`${action} prompt`))}
                  >
                    {t(action)}
                  </Button>
                ),
              )}
            </div>
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={running || !instruction.trim()}>
                {t("Generate")}
              </Button>
              {running && (
                <Button type="button" variant="ghost" onClick={cancel}>
                  {t("Cancel")}
                </Button>
              )}
            </div>
          </form>
          {running && (
            <p role="status" className="text-muted-foreground text-sm">
              {t("Generating")}
            </p>
          )}
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {t(error)}
            </p>
          )}
          {response && (
            <section
              className="space-y-3"
              aria-label={t("Response")}
              aria-busy={running}
            >
              <h3 className="text-sm font-medium">{t("Response")}</h3>
              <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                {response}
              </div>
              {complete && (
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => apply("replace")}>
                    {t("Replace selection")}
                  </Button>
                  <Button variant="outline" onClick={() => apply("insert")}>
                    {t("Insert below")}
                  </Button>
                  <Button variant="ghost" onClick={() => void copy()}>
                    {t(copied ? "Copied" : "Copy")}
                  </Button>
                </div>
              )}
            </section>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
