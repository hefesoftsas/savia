import {
  AssistantConfigurationClient,
  type AssistantModel,
} from "@/api/assistant-configuration-client";
import type { UIMessage } from "ai";
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
import { translationLabels, translationVariants } from "./translation-variants";
import { translationEmployeeTemplate } from "../personal-integrations/translation-employee-template";

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
  const [modelChoices, setModelChoices] = useState<AssistantModel[]>([]);
  const [defaultModel, setDefaultModel] = useState<string | null>(null);
  const [modelLoading, setModelLoading] = useState(true);
  const [modelError, setModelError] = useState(false);
  const [selectedModel, setSelectedModel] = useState("");
  const [modelRetry, setModelRetry] = useState(0);
  const [employees, setEmployees] = useState<VirtualEmployee[]>([]);
  const [creatingTranslator, setCreatingTranslator] = useState(false);
  const [translatorResponse, setTranslatorResponse] = useState(false);
  const [selectedVariant, setSelectedVariant] = useState(0);
  const [employeeId, setEmployeeId] = useState("");
  const [employeesError, setEmployeesError] = useState(false);
  const [employeesLoading, setEmployeesLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [instruction, setInstruction] = useState("");
  const [response, setResponse] = useState("");
  const [running, setRunning] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState<
    | "Request failed"
    | "Selection changed"
    | "Copy failed"
    | "Translator failed"
    | "Request timed out"
    | "Selected model disabled"
    | null
  >(null);
  const [copied, setCopied] = useState(false);
  const [history, setHistory] = useState<UIMessage[]>([]);
  const [clarification, setClarification] = useState("");
  const [resolvedModel, setResolvedModel] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const recoveryResponse = useRef<string | null>(null);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    let active = true;
    setModelLoading(true);
    setModelError(false);
    new AssistantConfigurationClient(api)
      .modelPolicy()
      .then((policy) => {
        if (!active) return;
        setModelChoices(
          Array.isArray(policy.allowedModels) ? policy.allowedModels : [],
        );
        setDefaultModel(
          typeof policy.defaultModel === "string" ? policy.defaultModel : null,
        );
      })
      .catch(() => {
        if (active) setModelError(true);
      })
      .finally(() => {
        if (active) setModelLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api, modelRetry]);

  useEffect(() => {
    let active = true;
    setEmployeesLoading(true);
    setEmployeesError(false);
    new VirtualEmployeesClient(api)
      .list()
      .then((items) => {
        if (active) setEmployees(items);
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

  useEffect(() => {
    if (!running) return;
    const started = Date.now();
    const timer = setInterval(
      () => setElapsed(Math.floor((Date.now() - started) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, [running]);

  function cancel() {
    controller.current?.abort();
    controller.current = null;
    setRunning(false);
    setResponse(recoveryResponse.current ?? "");
    setComplete(recoveryResponse.current !== null);
  }
  async function generate(continuing = false) {
    if (
      controller.current ||
      !instruction.trim() ||
      (continuing && !clarification.trim())
    )
      return;
    const current = new AbortController();
    controller.current = current;
    recoveryResponse.current = continuing ? response : null;
    setRunning(true);
    setElapsed(0);
    if (!continuing) setHistory([]);
    const timeout = setTimeout(() => {
      current.abort();
      if (controller.current === current) {
        controller.current = null;
        setRunning(false);
        setResponse(recoveryResponse.current ?? "");
        setComplete(recoveryResponse.current !== null);
        setError("Request timed out");
      }
    }, 90_000);
    setComplete(false);
    setResponse("");
    setError(null);
    setCopied(false);
    setSelectedVariant(0);
    setTranslatorResponse(
      employees.find((employee) => employee.id === employeeId)?.handle ===
        "traductor",
    );
    try {
      const result = await requestSelectionAI(api, {
        text,
        instruction: instruction.trim(),
        employeeId: employeeId || undefined,
        model: selectedModel || undefined,
        signal: current.signal,
        history: continuing ? history : [],
        clarification: continuing ? clarification.trim() : undefined,
        onMessages: (messages) => {
          if (controller.current === current) setHistory(messages);
        },
        onModel: (model) => {
          if (controller.current === current) setResolvedModel(model);
        },
        onText: (value) => {
          if (controller.current === current) setResponse(value);
        },
      });
      if (controller.current === current) {
        setResponse(result);
        setComplete(true);
        setClarification("");
      }
    } catch (failure) {
      if (controller.current === current && !current.signal.aborted) {
        if (
          failure instanceof Error &&
          "code" in failure &&
          failure.code === "ASSISTANT_MODEL_NOT_ALLOWED"
        ) {
          setError("Selected model disabled");
          setSelectedModel("");
          setResolvedModel(null);
          setModelRetry((value) => value + 1);
        } else setError("Request failed");
        setResponse(recoveryResponse.current ?? "");
        setComplete(recoveryResponse.current !== null);
      }
    } finally {
      clearTimeout(timeout);
      if (controller.current === current) {
        controller.current = null;
        setRunning(false);
      }
    }
  }
  function apply(mode: "replace" | "insert") {
    if (!canApplyResponse || running) return;
    if (onApply(appliedText, mode)) onClose();
    else setError("Selection changed");
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(appliedText);
      setCopied(true);
      setError(null);
    } catch {
      setError("Copy failed");
    }
  }

  const selectedEmployee = employees.find(
    (employee) => employee.id === employeeId,
  );
  const variants = complete ? translationVariants(response) : null;
  const appliedText = variants?.[selectedVariant] ?? response;
  const canApplyResponse =
    complete && (!translatorResponse || variants !== null);
  async function createTranslator() {
    if (creatingTranslator) return;
    setCreatingTranslator(true);
    setError(null);
    try {
      const data = await new VirtualEmployeesClient(api).create(
        translationEmployeeTemplate,
      );
      setEmployees((items) => [...items, data]);
      setEmployeeId(data.id);
      setInstruction(t("Translator prompt"));
    } catch {
      setError("Translator failed");
    } finally {
      setCreatingTranslator(false);
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
          <SheetDescription className="sr-only">
            {t("Description")}
          </SheetDescription>
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
                setResolvedModel(null);
                setSelectedModel("");
                setHistory([]);
                setResponse("");
                setComplete(false);
                if (
                  employees.find(
                    (employee) => employee.id === event.target.value,
                  )?.handle === "traductor"
                )
                  setInstruction(t("Translator prompt"));
              }}
            >
              <option value="">{t("Connected model")}</option>
              {employees
                .filter((employee) => employee.status === "active")
                .map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.name} (@{employee.handle})
                  </option>
                ))}
            </select>
            <details className="group text-sm">
              <summary className="min-h-11 cursor-pointer py-3 font-medium text-muted-foreground hover:text-foreground focus-visible:outline-ring">
                {t("Options")}
              </summary>
              <div className="space-y-3 pb-2">
                {modelChoices.length > 0 && (
                  <div className="space-y-2">
                    <Label htmlFor={`${id}-model`}>{t("Choose model")}</Label>
                    <select
                      id={`${id}-model`}
                      className="border-input bg-background focus-visible:ring-ring h-10 w-full min-w-0 rounded-md border px-3 text-sm focus-visible:ring-2"
                      value={selectedModel}
                      disabled={
                        running || modelLoading || modelChoices.length === 0
                      }
                      onChange={(event) => {
                        setSelectedModel(event.target.value);
                        setResolvedModel(null);
                      }}
                    >
                      <option value="">{t("Assistant default model")}</option>
                      {modelChoices.map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.name} ({model.id})
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {modelError ? (
                  <div className="text-sm text-muted-foreground">
                    <p role="status">{t("Models failed")}</p>
                    <Button
                      type="button"
                      variant="link"
                      className="h-auto p-0"
                      disabled={running}
                      onClick={() => setModelRetry((value) => value + 1)}
                    >
                      {t("Retry")}
                    </Button>
                  </div>
                ) : null}
                <p className="text-sm text-muted-foreground">
                  {t("Model")}:{" "}
                  <span className="break-words">
                    {resolvedModel ||
                      selectedModel ||
                      selectedEmployee?.model ||
                      defaultModel ||
                      t("Inherited model")}
                  </span>
                </p>
                {selectedEmployee && (
                  <details className="text-sm">
                    <summary className="cursor-pointer font-medium">
                      {t("Assistant instructions")}
                    </summary>
                    <div className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3">
                      {selectedEmployee.systemPrompt ||
                        t("No custom instructions")}
                    </div>
                  </details>
                )}
              </div>
            </details>
            {!employeesLoading &&
              !employeesError &&
              !employees.some(
                (employee) => employee.handle === "traductor",
              ) && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={running || creatingTranslator}
                  onClick={() => void createTranslator()}
                >
                  {t(
                    creatingTranslator
                      ? "Creating translator"
                      : "Create translator",
                  )}
                </Button>
              )}
            {employees.some(
              (employee) =>
                employee.handle === "traductor" &&
                employee.status === "inactive",
            ) && (
              <p className="text-sm text-muted-foreground">
                {t("Translator inactive")}
              </p>
            )}
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
            {selectedEmployee?.handle !== "traductor" && (
              <div className="flex flex-wrap gap-2">
                {(
                  ["Summarize", "Improve", "Translate", "Explain"] as const
                ).map((action) => (
                  <Button
                    key={action}
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={running}
                    onClick={() =>
                      setInstruction(
                        t(
                          action === "Translate" &&
                            employees.find(
                              (employee) => employee.id === employeeId,
                            )?.handle === "traductor"
                            ? "Translator prompt"
                            : `${action} prompt`,
                        ),
                      )
                    }
                  >
                    {t(action)}
                  </Button>
                ))}
              </div>
            )}
            <div className="flex items-center gap-3">
              <Button
                type="submit"
                disabled={running || creatingTranslator || !instruction.trim()}
              >
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
              {t("Generating")} {elapsed}s
              {elapsed >= 15 && (
                <span className="mt-1 block">{t("Slow request")}</span>
              )}
            </p>
          )}
          {complete && (
            <p role="status" className="sr-only">
              {t("Response ready")}
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
              {variants ? (
                <div className="space-y-3">
                  <fieldset className="flex flex-wrap gap-2">
                    <legend className="sr-only">
                      {t("Choose translation")}
                    </legend>
                    {variants.map((_variant, index) => (
                      <label
                        key={translationLabels[index]}
                        className="relative flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-accent has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring"
                      >
                        <input
                          type="radio"
                          name={`${id}-variant`}
                          aria-label={t(translationLabels[index])}
                          checked={selectedVariant === index}
                          onChange={() => {
                            setSelectedVariant(index);
                            setCopied(false);
                          }}
                          className="size-4 shrink-0 accent-primary"
                        />
                        {t(
                          (["Regular", "Professional", "Brief"] as const)[
                            index
                          ],
                        )}
                      </label>
                    ))}
                  </fieldset>
                  <div className="whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-sm leading-relaxed">
                    {variants[selectedVariant]}
                  </div>
                </div>
              ) : (
                <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                  {response}
                </div>
              )}
              {complete && !canApplyResponse && (
                <p role="status" className="text-sm text-muted-foreground">
                  {t("Translation needs clarification")}
                </p>
              )}
              {complete && !canApplyResponse && (
                <form
                  className="space-y-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void generate(true);
                  }}
                >
                  <Label htmlFor={`${id}-clarification`}>
                    {t("Clarification or format correction")}
                  </Label>
                  <Textarea
                    id={`${id}-clarification`}
                    rows={2}
                    value={clarification}
                    disabled={running}
                    onChange={(event) => setClarification(event.target.value)}
                  />
                  <Button
                    type="submit"
                    disabled={running || !clarification.trim()}
                  >
                    {t("Continue")}
                  </Button>
                </form>
              )}
              {canApplyResponse && (
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
