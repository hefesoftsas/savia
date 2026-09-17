import {
  cloneElement,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type KeyboardEvent,
} from "react";
import { useWatch } from "react-hook-form";
import {
  FormEngine,
  InjectedFieldProvider,
  RulesEngineProvider,
  type IEntityData,
  type IFieldProps,
} from "@form-eng/core";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCheck,
  LoaderCircle,
  Pencil,
  CornerDownLeft,
} from "lucide-react";
import {
  fieldEntries,
  R2_ATTACHMENT_TYPE,
  resolveFieldLabel,
  validateRecord,
  type CrmRecord,
  type CrmObject,
} from "@savia/crm-shared/metadata";
import type { AttachmentUploadStatus, PendingAttachment } from "./dynamic-form";
import type { TemporaryR2Attachment } from "./r2-attachment-upload";
import {
  evaluateCondition,
  isSectionVisible,
  prepareRecord,
} from "@savia/crm-shared/rules";
import { FORM_HTML_TYPE, DISPLAY_TEXT_TYPE } from "@savia/crm-shared/metadata";
import {
  formatMapLocationSummary,
  parseMapLocation,
} from "@savia/crm-shared/map-location";
import { registry } from "./fields";
import { api } from "./api";
import { useFieldLabelLocale } from "./localized-field-label-editor";
import "./conversation-wizard.css";
import { useDependentOptions } from "./dependent-options";
import { AttachmentQueueProvider } from "./attachment-queue";
const EMPTY: Record<string, unknown> = {};
const Context = createContext<{
  active: string | null;
  errors: Record<string, string>;
  busy: boolean;
  required: boolean;
}>({ active: null, errors: {}, busy: false, required: false });
function ConversationField({
  element,
  ...props
}: IFieldProps & { element: ReactElement<IFieldProps> }) {
  const state = useContext(Context),
    name = props.fieldName ?? "",
    active = state.active === name;
  const fieldProps = {
    ...props,
    required: active && state.required,
    readOnly: props.readOnly || state.busy,
    error: state.errors[name]
      ? { type: "validation", message: state.errors[name] }
      : props.error,
  };
  const { options } = useDependentOptions(props);
  return (
    <div hidden={!active} data-active-question={active || undefined}>
      {element.type === registry.Dropdown.type &&
      !props.config?.relation &&
      options?.length ? (
        <div
          role="radiogroup"
          aria-labelledby={`${name}_label`}
          aria-describedby={state.errors[name] ? `${name}_error` : undefined}
          aria-invalid={!!state.errors[name]}
          aria-required={fieldProps.required}
          className="conversation-choices"
          onKeyDown={(event) => {
            if (
              fieldProps.readOnly ||
              ![
                "ArrowDown",
                "ArrowUp",
                "ArrowLeft",
                "ArrowRight",
                "Home",
                "End",
              ].includes(event.key)
            )
              return;
            event.preventDefault();
            const current = options.findIndex((o) => o.value === props.value);
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? options.length - 1
                  : (Math.max(0, current) +
                      (["ArrowUp", "ArrowLeft"].includes(event.key) ? -1 : 1) +
                      options.length) %
                    options.length;
            props.setFieldValue?.(name, options[next].value);
            event.currentTarget
              .querySelectorAll<HTMLButtonElement>('[role="radio"]')
              [next]?.focus();
          }}
        >
          {options.map((option, index) => (
            <Button
              type="button"
              variant="outline"
              role="radio"
              aria-checked={props.value === option.value}
              tabIndex={
                props.value === option.value ||
                (!options.some((o) => o.value === props.value) && index === 0)
                  ? 0
                  : -1
              }
              disabled={fieldProps.readOnly}
              key={String(option.value)}
              onClick={() => props.setFieldValue?.(name, option.value)}
            >
              <span className="conversation-choice-index" aria-hidden="true">
                {index + 1}
              </span>
              <span>{option.label}</span>
              {props.value === option.value && (
                <Check size={18} className="conversation-choice-check" />
              )}
            </Button>
          ))}
        </div>
      ) : (
        cloneElement(element, fieldProps)
      )}
    </div>
  );
}
const conversationRegistry = Object.fromEntries(
  Object.entries(registry).map(([name, element]) => [
    name,
    <ConversationField element={element as ReactElement<IFieldProps>} />,
  ]),
);
function ObserveValues({
  onChange,
}: {
  onChange: (data: Record<string, unknown>) => void;
}) {
  const values = useWatch();
  useEffect(() => {
    onChange(values);
  }, [values, onChange]);
  return null;
}
const blank = (value: unknown) =>
  value == null || value === "" || (Array.isArray(value) && !value.length);
function SummaryValue({
  field,
  value,
}: {
  field: CrmObject["config"]["fields"][string];
  value: unknown;
}) {
  const ids = field.config?.relation
    ? (Array.isArray(value) ? value : blank(value) ? [] : [value]).map(String)
    : [];
  const relation = String(field.config?.relation ?? "");
  const names = useQuery({
    queryKey: ["wizard-summary", relation, ids],
    queryFn: () =>
      Promise.all(
        ids.map((id) =>
          api(`/records/${relation}/${encodeURIComponent(id)}`)
            .then((r) => String(r.data.name ?? r.data.title ?? id))
            .catch(() => "Registro no disponible"),
        ),
      ),
    enabled: !!ids.length,
  });
  if (field.type === FORM_HTML_TYPE || field.type === DISPLAY_TEXT_TYPE)
    return <span className="conversation-empty-value">Bloque visual</span>;
  if (blank(value))
    return <span className="conversation-empty-value">Sin completar</span>;
  if (ids.length) return <>{names.data?.join(", ") ?? "Cargando…"}</>;
  if (field.type === "Toggle") return <>{value ? "Sí" : "No"}</>;
  if (field.type === "MapLocation") {
    const location = parseMapLocation(value);
    return <>{location ? formatMapLocationSummary(location) : String(value)}</>;
  }
  if (field.type === "Currency" || field.config?.format === "currency") {
    const code = String(field.config?.currency || "COP");
    const decimals =
      typeof field.config?.decimals === "number"
        ? field.config.decimals
        : field.config?.integer
          ? 0
          : 2;
    return (
      <>
        {new Intl.NumberFormat("es-CO", {
          style: "currency",
          currency: code,
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
        }).format(Number(value))}
      </>
    );
  }
  return (
    <>
      {field.options?.find((option) => option.value === value)?.label ??
        String(value)}
    </>
  );
}
export default function ConversationWizard({
  object,
  values = EMPTY,
  onSave,
  onPersistAttachments,
  onUploadTemporaryAttachment,
  onPersistTemporaryAttachments,
  onDiscardTemporaryAttachments,
  onSaved,
  submitLabel = "Guardar registro",
  renderFieldActions,
}: {
  object: CrmObject;
  values?: Record<string, unknown>;
  onSave: (
    data: Record<string, unknown>,
    previous?: CrmRecord,
  ) => Promise<CrmRecord | void>;
  onPersistAttachments?: (
    record: CrmRecord,
    attachments: PendingAttachment[],
    onStatus: (status: AttachmentUploadStatus) => void,
  ) => Promise<void>;
  onUploadTemporaryAttachment?: (
    field: string,
    file: File,
  ) => Promise<TemporaryR2Attachment>;
  onPersistTemporaryAttachments?: (
    record: CrmRecord,
    attachments: TemporaryR2Attachment[],
  ) => Promise<void>;
  onDiscardTemporaryAttachments?: (
    attachments: TemporaryR2Attachment[],
  ) => Promise<void>;
  onSaved?: (record: CrmRecord | void) => void;
  submitLabel?: string;
  renderFieldActions?: (field: string) => ReactNode;
}) {
  const labelLocale = useFieldLabelLocale();
  const defaults = useMemo(
    () =>
      prepareRecord(
        object,
        Object.fromEntries(
          fieldEntries(object).map(([name, field]) => [
            name,
            values[name] ??
              field.defaultValue ??
              (field.config?.multiple || field.type === R2_ATTACHMENT_TYPE
                ? []
                : field.type === "Toggle"
                  ? false
                  : ""),
          ]),
        ),
      ),
    [object, values],
  );
  const [live, setLive] = useState(defaults),
    [position, setPosition] = useState(0),
    [review, setReview] = useState(false),
    [editingReview, setEditingReview] = useState(false),
    [errors, setErrors] = useState<Record<string, string>>({}),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false),
    [ready, setReady] = useState(false),
    [focusRequest, setFocusRequest] = useState(0);
  const [queuedAttachments, setQueuedAttachments] = useState<
    Record<string, File[]>
  >({});
  const [uploadingAttachments, setUploadingAttachments] = useState<
    Record<string, File | undefined>
  >({});
  const [temporaryAttachments, setTemporaryAttachments] = useState<
    { field: string; file: File; attachment: TemporaryR2Attachment }[]
  >([]);
  const [attachmentVersion, setAttachmentVersion] = useState(0);
  const [savedRecordId, setSavedRecordId] = useState(() =>
    String(values.id ?? ""),
  );
  const [savedRecord, setSavedRecord] = useState<CrmRecord | undefined>();
  const queuedAttachmentsRef = useRef<Record<string, File[]>>({});
  const temporaryAttachmentsRef = useRef<
    { field: string; file: File; attachment: TemporaryR2Attachment }[]
  >([]);
  const handledAttachmentsRef = useRef(new Set<File>());
  const cancelledRef = useRef(false);
  const discardTemporaryAttachmentsRef = useRef(onDiscardTemporaryAttachments);
  useEffect(() => {
    discardTemporaryAttachmentsRef.current = onDiscardTemporaryAttachments;
  }, [onDiscardTemporaryAttachments]);
  useEffect(
    () => () => {
      cancelledRef.current = true;
      const attachments = temporaryAttachmentsRef.current.map(
        ({ attachment }) => attachment,
      );
      if (attachments.length)
        void discardTemporaryAttachmentsRef.current?.(attachments);
    },
    [],
  );
  const editorKey = `${object.name}:${String(values.id ?? "new")}`;
  useEffect(() => {
    queuedAttachmentsRef.current = {};
    temporaryAttachmentsRef.current = [];
    handledAttachmentsRef.current.clear();
    cancelledRef.current = false;
    setQueuedAttachments({});
    setUploadingAttachments({});
    setTemporaryAttachments([]);
    setAttachmentVersion(0);
    setSavedRecordId(String(values.id ?? ""));
    setSavedRecord(undefined);
  }, [editorKey, values.id]);
  const replaceTemporaryAttachments = (
    next: { field: string; file: File; attachment: TemporaryR2Attachment }[],
  ) => {
    temporaryAttachmentsRef.current = next;
    setTemporaryAttachments(next);
  };
  const setAttachmentFiles = (field: string, files: File[]) => {
    const next = { ...queuedAttachmentsRef.current, [field]: files };
    queuedAttachmentsRef.current = next;
    setQueuedAttachments(next);
  };
  useEffect(() => {
    if (!onUploadTemporaryAttachment) return;
    const removed = temporaryAttachmentsRef.current.filter(
      ({ field, file }) => !queuedAttachmentsRef.current[field]?.includes(file),
    );
    if (removed.length) {
      replaceTemporaryAttachments(
        temporaryAttachmentsRef.current.filter(
          (entry) => !removed.includes(entry),
        ),
      );
      if (onDiscardTemporaryAttachments)
        void onDiscardTemporaryAttachments(
          removed.map(({ attachment }) => attachment),
        ).catch((cause: Error) => setError(cause.message));
    }
    for (const [field, files] of Object.entries(queuedAttachments))
      for (const file of files) {
        if (handledAttachmentsRef.current.has(file)) continue;
        handledAttachmentsRef.current.add(file);
        setUploadingAttachments((previous) => ({ ...previous, [field]: file }));
        void onUploadTemporaryAttachment(field, file)
          .then(async (attachment) => {
            if (
              cancelledRef.current ||
              !queuedAttachmentsRef.current[field]?.includes(file)
            ) {
              await onDiscardTemporaryAttachments?.([attachment]);
              return;
            }
            replaceTemporaryAttachments([
              ...temporaryAttachmentsRef.current,
              { field, file, attachment },
            ]);
            setAttachmentVersion((version) => version + 1);
          })
          .catch((cause: Error) => setError(cause.message))
          .finally(() =>
            setUploadingAttachments((previous) => ({
              ...previous,
              [field]: undefined,
            })),
          );
      }
  }, [
    onDiscardTemporaryAttachments,
    onUploadTemporaryAttachment,
    queuedAttachments,
  ]);
  const uploadedAttachmentFiles = useMemo(
    () =>
      temporaryAttachments.reduce<Record<string, File[]>>((files, entry) => {
        files[entry.field] = [...(files[entry.field] ?? []), entry.file];
        return files;
      }, {}),
    [temporaryAttachments],
  );
  const hasPendingAttachmentUpload =
    Object.values(uploadingAttachments).some(Boolean);
  const markAttachmentUploaded = (field: string, file: File) =>
    setQueuedAttachments((previous) => ({
      ...previous,
      [field]: (previous[field] ?? []).filter((queued) => queued !== file),
    }));
  const refreshAttachments = (field: string, file: File) => {
    markAttachmentUploaded(field, file);
    setAttachmentVersion((version) => version + 1);
  };
  const updateAttachmentStatus = ({
    field,
    file,
    status,
  }: AttachmentUploadStatus) => {
    if (status === "uploading") {
      setUploadingAttachments((previous) => ({ ...previous, [field]: file }));
      return;
    }
    setUploadingAttachments((previous) => ({
      ...previous,
      [field]: undefined,
    }));
    refreshAttachments(field, file);
  };
  const root = useRef<HTMLDivElement>(null),
    heading = useRef<HTMLHeadingElement>(null),
    continueButton = useRef<HTMLButtonElement>(null),
    saving = useRef(false);
  const steps = object.config.studio!.wizard!.steps;
  const onValues = useCallback((data: Record<string, unknown>) => {
    setLive((previous) =>
      JSON.stringify(previous) === JSON.stringify(data) ? previous : data,
    );
    setReady(true);
  }, []);
  const prepared = useMemo(() => prepareRecord(object, live), [object, live]);
  const visible = useMemo(
    () =>
      fieldEntries(object)
        .filter(([name, field]) => {
          if (field.hidden) return false;
          const section = field.config?.section
            ? object.config.studio?.sections?.find(
                (s) => s.id === field.config?.section,
              )
            : undefined;
          if (field.config?.section && !isSectionVisible(section, prepared)) {
            return false;
          }
          return evaluateCondition(field.config?.visibleWhen as any, prepared);
        })
        .sort(
          ([, a], [, b]) =>
            steps.findIndex((s) => s.id === a.config?.step) -
            steps.findIndex((s) => s.id === b.config?.step),
        ),
    [object, prepared, steps],
  );
  const questions = visible.filter(
    ([, field]) => !field.readOnly && !field.config?.formula,
  );
  const index = Math.min(position, Math.max(0, questions.length - 1));
  const question = questions[index],
    isReview = review || !question;
  const [name, field] = question ?? ["", undefined];
  const step = steps.find((s) => s.id === field?.config?.step) ?? steps[0];
  const stepIndex = steps.findIndex((s) => s.id === step?.id);
  const required =
    !!field &&
    (field.required ||
      (!!field.config?.requiredWhen &&
        evaluateCondition(field.config.requiredWhen as any, prepared)));
  const config = useMemo(
    () => ({
      ...object.config,
      settings: { ...object.config.settings, manualSave: true },
      fields: Object.fromEntries(
        fieldEntries(object).map(([key, f]) => [
          key,
          {
            ...f,
            type: f.config?.collectionRelationTarget ? "CrmCollectionRelation" : f.config?.relation ? "CrmRelation" : f.type,
            required: false,
            readOnly: f.readOnly || !!f.config?.formula,
            config: {
              ...f.config,
              recordId: values.id ?? savedRecordId,
              studioObject: object,
            },
          },
        ]),
      ),
    }),
    [object, savedRecordId, values.id],
  );
  useEffect(() => {
    if (!ready) return;
    const control =
      !isReview &&
      root.current?.querySelector<HTMLElement>(
        '[data-active-question="true"] input:not(:disabled),[data-active-question="true"] textarea:not(:disabled),[data-active-question="true"] button:not(:disabled)',
      );
    const touch =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(pointer: coarse)").matches;
    if (control && (!touch || focusRequest > 0)) control.focus();
    else heading.current?.focus();
  }, [name, isReview, ready, focusRequest]);
  function goTo(index: number) {
    setPosition(index);
    setReview(false);
    setErrors({});
    setError("");
    setFocusRequest((n) => n + 1);
  }
  function keyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (
      e.key !== "Enter" ||
      e.nativeEvent.isComposing ||
      e.altKey ||
      busy ||
      saved
    )
      return;
    const target = e.target as HTMLElement;
    if (
      target.closest(
        'button,a,[role="combobox"],[role="listbox"],[role="radio"]',
      )
    )
      return;
    if (target.tagName === "TEXTAREA" && !e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    continueButton.current?.click();
  }
  async function submit(data: Record<string, unknown>) {
    if (saving.current || saved) return;
    setError("");
    setErrors({});
    const validated = validateRecord(object, data);
    const applicable = isReview
      ? validated.errors
      : Object.fromEntries(
          Object.entries(validated.errors).filter(
            ([key]) => key === name || key === "_form",
          ),
        );
    if (Object.keys(applicable).length) {
      setErrors(applicable);
      if (isReview) {
        const first = questions.findIndex(([key]) => !!applicable[key]);
        if (first >= 0) {
          setPosition(first);
          setReview(false);
          setEditingReview(true);
        }
        setError("Hay una respuesta que necesita tu atención.");
      } else if (applicable._form) setError(applicable._form);
      setFocusRequest((n) => n + 1);
      return;
    }
    if (!isReview) {
      if (editingReview || index === questions.length - 1) {
        setReview(true);
        setEditingReview(false);
      } else setPosition(index + 1);
      return;
    }
    if (hasPendingAttachmentUpload) {
      setError("Espera a que termine la carga de los archivos.");
      return;
    }
    const temporary = temporaryAttachmentsRef.current.map(
      ({ attachment }) => attachment,
    );
    const queuedCount = Object.values(queuedAttachments).reduce(
      (total, files) => total + files.length,
      0,
    );
    if (onUploadTemporaryAttachment && queuedCount !== temporary.length) {
      setError(
        "Revisa los archivos antes de guardar. Uno o más no se pudieron cargar.",
      );
      return;
    }
    saving.current = true;
    setBusy(true);
    try {
      const attachments = fieldEntries(object).flatMap(([field, definition]) =>
        definition.type === R2_ATTACHMENT_TYPE &&
        queuedAttachments[field]?.length
          ? [{ field, files: queuedAttachments[field] }]
          : [],
      );
      const savedResult = savedRecord
        ? await onSave(validated.data, savedRecord)
        : await onSave(validated.data);
      if (savedResult) {
        setSavedRecord(savedResult);
        setSavedRecordId(savedResult.id);
      }
      if (temporary.length) {
        if (!savedResult || !onPersistTemporaryAttachments)
          throw new Error(
            "No se pudieron asociar los archivos al registro. Inténtalo de nuevo.",
          );
        await onPersistTemporaryAttachments(savedResult, temporary);
        queuedAttachmentsRef.current = {};
        setQueuedAttachments({});
        replaceTemporaryAttachments([]);
        setAttachmentVersion((version) => version + 1);
      } else if (attachments.length) {
        if (!savedResult || !onPersistAttachments)
          throw new Error(
            "No se pudieron preparar los archivos para R2. Guarda el registro e inténtalo de nuevo.",
          );
        await onPersistAttachments(
          savedResult,
          attachments,
          updateAttachmentStatus,
        );
      }
      onSaved?.(savedResult);
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      saving.current = false;
      setBusy(false);
      setUploadingAttachments({});
    }
  }
  if (saved)
    return (
      <div className="conversation-success" role="status">
        <CheckCheck size={36} />
        <h3>Listo, tus respuestas se guardaron.</h3>
        <p>Puedes continuar con tu trabajo.</p>
      </div>
    );
  const answerCount = questions.filter(([key]) => !blank(prepared[key])).length;
  return (
    <div ref={root} className="conversation-wizard" onKeyDown={keyDown}>
      <header className="conversation-header">
        <span className="conversation-object">{object.label}</span>
        <span className="conversation-counter" role="status">
          {isReview
            ? "Revisión final"
            : `Pregunta ${index + 1} de ${questions.length}`}
        </span>
      </header>
      <div
        className="conversation-progress"
        role="progressbar"
        aria-label="Progreso del formulario"
        aria-valuemin={0}
        aria-valuemax={questions.length || 1}
        aria-valuenow={isReview ? questions.length || 1 : index}
      >
        <span
          style={{
            transform: `scaleX(${isReview ? 1 : index / Math.max(1, questions.length)})`,
          }}
        />
      </div>
      <Context.Provider
        value={{
          active: isReview ? null : name,
          errors,
          busy,
          required: !!required,
        }}
      >
        <AttachmentQueueProvider
          value={{
            files: queuedAttachments,
            setFiles: setAttachmentFiles,
            uploading: uploadingAttachments,
            uploaded: uploadedAttachmentFiles,
            version: attachmentVersion,
          }}
        >
          <RulesEngineProvider>
            <InjectedFieldProvider injectedFields={conversationRegistry}>
              <div className="conversation-body">
                <div
                  key={isReview ? "review" : name}
                  className="conversation-prompt"
                >
                  <div className="conversation-section">
                    <span>
                      {isReview
                        ? "Antes de terminar"
                        : `${stepIndex + 1} / ${steps.length} · ${step?.title}`}
                    </span>
                    {!isReview && !required && (
                      <span className="conversation-optional">Opcional</span>
                    )}
                  </div>
                  <h3 ref={heading} tabIndex={-1}>
                    {isReview
                      ? "¿Todo está bien?"
                      : field
                        ? resolveFieldLabel(field, labelLocale)
                        : null}
                  </h3>
                  <p>
                    {isReview
                      ? "Revisa tus respuestas. Puedes cambiar cualquiera antes de guardar."
                      : field?.description ||
                        step?.description ||
                        (required
                          ? "Completa esta respuesta para continuar."
                          : "Puedes responder ahora o continuar sin este dato.")}
                  </p>
                </div>
                {isReview && (
                  <div className="conversation-review">
                    {steps.map((s) => {
                      const entries = visible.filter(
                        ([, f]) => f.config?.step === s.id,
                      );
                      return entries.length ? (
                        <section key={s.id}>
                          <h4>{s.title}</h4>
                          <dl>
                            {entries.map(([key, f]) => {
                              const fieldLabel = resolveFieldLabel(
                                f,
                                labelLocale,
                              );
                              return (
                                <div className="conversation-answer" key={key}>
                                  <div>
                                    <dt>{fieldLabel}</dt>
                                    <dd>
                                      <SummaryValue
                                        field={f}
                                        value={prepared[key]}
                                      />
                                    </dd>
                                  </div>
                                  {!f.readOnly && !f.config?.formula && (
                                    <Button
                                      type="button"
                                      size="icon"
                                      variant="ghost"
                                      aria-label={`Cambiar ${fieldLabel}`}
                                      disabled={busy}
                                      onClick={() => {
                                        goTo(
                                          questions.findIndex(
                                            ([k]) => k === key,
                                          ),
                                        );
                                        setEditingReview(true);
                                      }}
                                    >
                                      <Pencil size={16} />
                                    </Button>
                                  )}
                                </div>
                              );
                            })}
                          </dl>
                        </section>
                      ) : null;
                    })}
                  </div>
                )}
                <FormEngine
                  configName={`conversation-${object.name}-${values.id ?? "new"}`}
                  programName="savia-crm"
                  formConfig={config}
                  defaultValues={defaults as IEntityData}
                  entityType={object.name}
                  entityId={String(values.id ?? "new")}
                  isCreate={!values.id}
                  isManualSave
                  renderSaveButton={() => null}
                  renderStatus={() => null}
                  renderLabel={({ id }) => (
                    <div
                      hidden={isReview || id !== name}
                      className="conversation-field-label"
                    >
                      <label
                        id={`${id}_label`}
                        htmlFor={id}
                        className="sr-only"
                      >
                        {object.config.fields[id]?.label}
                      </label>
                      {id === name && !isReview && renderFieldActions?.(id)}
                    </div>
                  )}
                  renderError={({ id, error: runtimeError }) =>
                    errors[id] || runtimeError ? (
                      <p
                        hidden={isReview || id !== name}
                        id={`${id}_error`}
                        className="conversation-field-error"
                        role="alert"
                      >
                        {errors[id] ?? runtimeError?.message}
                      </p>
                    ) : null
                  }
                  onSubmit={submit}
                  renderSubmitButton={({ onSubmit, isSubmitting }) => (
                    <>
                      <ObserveValues onChange={onValues} />
                      <footer className="conversation-actions">
                        <div className="conversation-primary-action">
                          <Button
                            ref={continueButton}
                            type="button"
                            onClick={onSubmit}
                            disabled={
                              busy || isSubmitting || hasPendingAttachmentUpload
                            }
                            size="lg"
                          >
                            {busy ? (
                              <>
                                <LoaderCircle
                                  size={18}
                                  className="animate-spin"
                                />
                                Guardando…
                              </>
                            ) : isReview ? (
                              <>
                                <Check size={18} />
                                {submitLabel}
                              </>
                            ) : editingReview ? (
                              "Volver a la revisión"
                            ) : index === questions.length - 1 ? (
                              "Revisar respuestas"
                            ) : (
                              <>
                                Continuar
                                <ArrowRight size={18} />
                              </>
                            )}
                          </Button>
                          {!isReview && (
                            <span className="conversation-key-hint">
                              {field?.type === "Textarea"
                                ? "Ctrl / ⌘ + Enter"
                                : field?.config?.relation
                                  ? "Selecciona y continúa"
                                  : field?.type === "Dropdown"
                                    ? "Usa ↑ ↓ para elegir"
                                    : field?.type === "Toggle"
                                      ? "Espacio para cambiar"
                                      : "Pulsa Enter"}
                              {field?.type !== "Dropdown" &&
                                field?.type !== "Toggle" &&
                                !field?.config?.relation && (
                                  <CornerDownLeft size={13} />
                                )}
                            </span>
                          )}
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={
                            busy ||
                            isSubmitting ||
                            !questions.length ||
                            (!isReview && index === 0)
                          }
                          onClick={() => {
                            setEditingReview(false);
                            goTo(isReview ? questions.length - 1 : index - 1);
                          }}
                        >
                          <ArrowLeft size={16} />
                          Atrás
                        </Button>
                        <p className="conversation-footnote">
                          {isReview
                            ? `${answerCount} de ${questions.length} respuestas completadas. Se guardarán juntas.`
                            : "Puedes volver atrás en cualquier momento."}
                        </p>
                      </footer>
                    </>
                  )}
                />
                {error && (
                  <div className="conversation-error" role="alert">
                    {error}
                  </div>
                )}
              </div>
            </InjectedFieldProvider>
          </RulesEngineProvider>
        </AttachmentQueueProvider>
      </Context.Provider>
    </div>
  );
}
