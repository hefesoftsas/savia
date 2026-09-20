import { useMessages } from "@/i18n/core";
import { recordsMessages } from "@/i18n/locales/records";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { useFormContext } from "react-hook-form";
import { Button } from "@/components/ui/button";
import {
  resolveLookupButtonStyle,
  resolveLookupPlacement,
  resolveLookupEventDebounce,
  resolveLookupEventDebounceMs,
  resolveLookupTriggerEvents,
  resolveRequestActionLabel,
  type LookupTriggerEvent,
  type RequestAction,
} from "@savia/crm-shared/request-page";
import { jsonPointer } from "@savia/crm-shared/collection-operations";
import type { PageRun } from "./request-page-api";
import {
  LookupActionButtonContent,
  lookupActionUsesIcon,
} from "./lookup-action-button";
import { useFieldLabelLocale } from "./localized-field-label-editor";

function resolveEventDebounceMs(action: RequestAction) {
  if (!resolveLookupEventDebounce(action)) return 0;
  return resolveLookupEventDebounceMs(action);
}

function fieldControlTargets(formField: Element | null, fieldName: string) {
  if (!formField) {
    const direct = document.getElementById(fieldName);
    return direct ? [direct] : [];
  }
  const controls = Array.from(
    formField.querySelectorAll<HTMLElement>(
      "input, textarea, select, [role='combobox']",
    ),
  );
  if (controls.length) return controls;
  const direct = formField.querySelector<HTMLElement>(
    `#${CSS.escape(fieldName)}`,
  );
  return direct ? [direct] : [];
}

async function applyLookupResult({
  t,
  action,
  run,
  before,
  getValues,
  setValue,
}: {
  t: ReturnType<typeof useMessages<typeof recordsMessages>>;
  action: RequestAction;
  run: PageRun;
  before: Record<string, unknown>;
  getValues: (name?: string) => unknown;
  setValue: (
    name: string,
    value: unknown,
    options?: {
      shouldDirty?: boolean;
      shouldValidate?: boolean;
    },
  ) => void;
}): Promise<{ ok: boolean; message: string; staleInput?: boolean }> {
  if (
    JSON.stringify(Object.values(action.input).map((key) => before[key])) !==
    JSON.stringify(Object.values(action.input).map((key) => getValues(key)))
  ) {
    return {
      ok: false,
      staleInput: true,
      message: t(
        "Cambió la entrada; consulta de nuevo para completar los campos.",
      ),
    };
  }
  if (!run.result || !["success", "partial"].includes(run.result.status)) {
    return {
      ok: false,
      message:
        run.error ??
        run.result?.errors[0]?.message ??
        t("La consulta no devolvió datos utilizables."),
    };
  }
  for (const [field, pointer] of Object.entries(action.output)) {
    const value = jsonPointer(run.result, pointer);
    setValue(field, value ?? "", {
      shouldDirty: true,
      shouldValidate: true,
    });
  }
  return {
    ok: true,
    message: t("Campos actualizados con la respuesta de la consulta."),
  };
}

function useLookupExecutor(
  execute: (
    action: RequestAction,
    values: Record<string, unknown>,
  ) => Promise<PageRun>,
) {
  const t = useMessages(recordsMessages);

  const { getValues, setValue } = useFormContext();
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [staleInput, setStaleInput] = useState(false);
  const lock = useRef(false);

  const runAction = useCallback(
    async (action: RequestAction) => {
      if (lock.current) return;
      lock.current = true;
      setBusy(action.id);
      setMessage("");
      setStaleInput(false);
      const before = getValues();
      try {
        const run = await execute(action, before);
        const result = await applyLookupResult({
          t,
          action,
          run,
          before,
          getValues,
          setValue,
        });
        setMessage(result.message);
        setStaleInput(result.staleInput ?? false);
      } catch (e) {
        setMessage((e as Error).message);
      } finally {
        lock.current = false;
        setBusy("");
      }
    },
    [execute, getValues, setValue, t],
  );

  useEffect(() => {
    if (!message || staleInput || busy) return;
    const timer = window.setTimeout(() => setMessage(""), 4000);
    return () => window.clearTimeout(timer);
  }, [message, busy, staleInput]);

  return {
    busy,
    message: staleInput
      ? t("Cambió la entrada; consulta de nuevo para completar los campos.")
      : message,
    runAction,
  };
}

function bindLookupFieldEvents({
  anchor,
  fieldName,
  actions,
  runAction,
}: {
  anchor: HTMLElement | null;
  fieldName: string;
  actions: RequestAction[];
  runAction: (action: RequestAction) => Promise<void>;
}) {
  const cleanups: (() => void)[] = [];
  const debouncers = new Map<string, number>();
  const formField = anchor?.closest(".form-field") ?? null;
  const targets = fieldControlTargets(formField, fieldName);
  if (!targets.length) return cleanups;

  for (const action of actions) {
    for (const eventName of resolveLookupTriggerEvents(action)) {
      const handler = (nativeEvent: Event) => {
        if (eventName === "keydown.enter") {
          if (
            !(nativeEvent instanceof KeyboardEvent) ||
            nativeEvent.key !== "Enter"
          )
            return;
          if (
            nativeEvent.target instanceof HTMLTextAreaElement &&
            !nativeEvent.ctrlKey &&
            !nativeEvent.metaKey
          ) {
            return;
          }
        }
        const debounceMs = resolveEventDebounceMs(action);
        if (debounceMs > 0) {
          const key = `${action.id}:${eventName}`;
          window.clearTimeout(debouncers.get(key));
          debouncers.set(
            key,
            window.setTimeout(() => {
              debouncers.delete(key);
              void runAction(action);
            }, debounceMs),
          );
          return;
        }
        void runAction(action);
      };
      const nativeEvent = eventName === "keydown.enter" ? "keydown" : eventName;
      for (const target of targets) {
        target.addEventListener(nativeEvent, handler);
        cleanups.push(() => target.removeEventListener(nativeEvent, handler));
      }
    }
  }

  cleanups.push(() => {
    for (const timer of debouncers.values()) window.clearTimeout(timer);
    debouncers.clear();
  });
  return cleanups;
}

function useLookupFieldEvents({
  fieldName,
  actions,
  anchorRef,
  runAction,
}: {
  fieldName: string;
  actions: RequestAction[];
  anchorRef: RefObject<HTMLElement | null>;
  runAction: (action: RequestAction) => Promise<void>;
}) {
  useEffect(() => {
    const eventActions = actions.filter(
      (action) => resolveLookupTriggerEvents(action).length > 0,
    );
    if (!eventActions.length) return;

    let cancelled = false;
    let cleanups: (() => void)[] = [];
    let attempts = 0;

    const bind = () => {
      cleanups.forEach((cleanup) => cleanup());
      cleanups = bindLookupFieldEvents({
        anchor: anchorRef.current,
        fieldName,
        actions: eventActions,
        runAction,
      });
      return cleanups.length > 0;
    };

    if (!bind()) {
      const timer = window.setInterval(() => {
        if (cancelled || bind() || ++attempts >= 24) {
          window.clearInterval(timer);
        }
      }, 100);
      return () => {
        cancelled = true;
        window.clearInterval(timer);
        cleanups.forEach((cleanup) => cleanup());
      };
    }

    return () => {
      cancelled = true;
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [actions, anchorRef, fieldName, runAction]);
}

export function LookupActions({
  fieldName,
  actions,
  execute,
}: {
  fieldName: string;
  actions: RequestAction[];
  execute: (
    action: RequestAction,
    values: Record<string, unknown>,
  ) => Promise<PageRun>;
}) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const { busy, message, runAction } = useLookupExecutor(execute);
  const labelLocale = useFieldLabelLocale();
  const placement =
    actions.length > 0 ? resolveLookupPlacement(actions[0]) : "inline-end";

  useLookupFieldEvents({
    fieldName,
    actions,
    anchorRef,
    runAction,
  });

  return (
    <>
      <span ref={anchorRef} hidden aria-hidden="true" />
      <div className="lookup-field-actions" data-placement={placement}>
        {actions.map((action) => {
          const actionLabel = resolveRequestActionLabel(action, labelLocale);
          return (
            <Button
              key={action.id}
              type="button"
              variant="default"
              size={lookupActionUsesIcon(action) ? "icon" : "sm"}
              className={
                lookupActionUsesIcon(action) ? "size-9 shrink-0" : undefined
              }
              data-lookup-style={resolveLookupButtonStyle(action)}
              aria-label={actionLabel}
              title={actionLabel}
              disabled={!!busy}
              onClick={() => void runAction(action)}
            >
              <LookupActionButtonContent
                action={action}
                busy={busy === action.id}
                label={actionLabel}
              />
            </Button>
          );
        })}
      </div>
      {message && (
        <p
          role="status"
          className="lookup-field-status lookup-field-status--compact text-sm"
        >
          {message}
        </p>
      )}
    </>
  );
}

export type { LookupTriggerEvent };
