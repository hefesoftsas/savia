import { RelatedRecordEditor } from "./related-record-editor";
import type { RelatedRecordChanges } from "@savia/crm-shared/related-records";
import { DateTimeField } from "./date-time-field";
import { CollectionOptionField } from "./collection-option-field";
import {
  cloneElement,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { useWatch } from "react-hook-form";
import {
  FormEngine,
  InjectedFieldProvider,
  RulesEngineProvider,
  registerLocale,
  type IEntityData,
  type IFieldProps,
} from "@form-eng/core";
import ConversationWizard from "./conversation-wizard";
import { AttachmentQueueProvider } from "./attachment-queue";
import { registry } from "./fields";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ArrowLeft, ArrowRight, Check, LoaderCircle, Save } from "lucide-react";
import {
  fieldEntries,
  FORM_HTML_TYPE,
  DISPLAY_TEXT_TYPE,
  R2_ATTACHMENT_TYPE,
  resolveFieldLabel,
  validateRecord,
  type CrmRecord,
  type CrmObject,
} from "@savia/crm-shared/metadata";
import { useFieldLabelLocale } from "./localized-field-label-editor";
import { evaluateCondition, isSectionVisible, prepareRecord } from "@savia/crm-shared/rules";
import type { TemporaryR2Attachment } from "./r2-attachment-upload";
import "./designer-enhancements.css";
import "./wizard.css";
const EMPTY_VALUES: Record<string, unknown> = {};
registerLocale({
  save: "Guardar",
  create: "Crear",
  cancel: "Cancelar",
  saving: "Guardando…",
});

const WizardContext = createContext<{
  active: string;
  first: string;
  activeTitle?: string;
} | null>(null);
function WizardField({
  element,
  object,
  ...props
}: IFieldProps & { element: ReactElement<IFieldProps>; object: CrmObject }) {
  const wizard = useContext(WizardContext);
  const values = useWatch();
  const section = props.config?.section
    ? object.config.studio?.sections?.find((s) => s.id === props.config?.section)
    : undefined;
  const hidden =
    (!!wizard && (props.config?.step ?? wizard.first) !== wizard.active) ||
    (!!props.config?.section && !isSectionVisible(section, values)) ||
    Boolean(
      props.config?.visibleWhen &&
      !evaluateCondition(props.config.visibleWhen as any, values),
    );
  return (
    <div
      hidden={hidden}
      {...(hidden ? { inert: true, "aria-hidden": true } : {})}
    >
      {props.config?.collectionRelationTarget && ["subform", "table"].includes(String(props.config?.relationPresentation)) ? <RelatedRecordEditor {...props} /> : props.config?.dateTime === true ? <DateTimeField {...props} /> : props.config?.collectionOptions ? <CollectionOptionField {...props} objectName={object.name} numeric={object.config.fields[props.fieldName!]?.type === "Number" || object.config.fields[props.fieldName!]?.type === "Currency"} /> : cloneElement(element, props)}
    </div>
  );
}
const wizardRegistry = (object: CrmObject) =>
  Object.fromEntries(
    Object.entries(registry).map(([name, element]) => [
      name,
      <WizardField
        object={object}
        element={element as ReactElement<IFieldProps>}
      />,
    ]),
  );

function FormValuesObserver({
  onChange,
}: {
  onChange?: (values: Record<string, unknown>) => void;
}) {
  const values = useWatch();
  const callback = useRef(onChange);
  callback.current = onChange;
  const serialized = JSON.stringify(values);
  useEffect(() => {
    callback.current?.(JSON.parse(serialized));
  }, [serialized]);
  return null;
}

function FieldLabel({ object, name }: { object: CrmObject; name: string }) {
  const values = useWatch();
  const wizard = useContext(WizardContext);
  const locale = useFieldLabelLocale();
  const field = object.config.fields[name];
  if (!field) return null;
  if (field.type === FORM_HTML_TYPE || field.type === DISPLAY_TEXT_TYPE) {
    if (!field.description) return null;
    return (
      <p className="studio-field-help form-html-field-description">
        {field.description}
      </p>
    );
  }
  const cfg = field.config ?? {};
  const studio = (object.config as any).studio;
  const sectionDef = cfg.section
    ? studio?.sections?.find((s: { id: string }) => s.id === cfg.section)
    : undefined;
  const sectionVisible = !cfg.section || isSectionVisible(sectionDef, values);
  const visible =
    sectionVisible &&
    !field.hidden &&
    (!wizard || (cfg.step ?? wizard.first) === wizard.active) &&
    (!cfg.visibleWhen || evaluateCondition(cfg.visibleWhen as any, values));
  const required =
    visible &&
    (field.required ||
      (cfg.requiredWhen && evaluateCondition(cfg.requiredWhen as any, values)));
  const entries = fieldEntries(object);
  const firstInSection =
    cfg.section &&
    sectionVisible &&
    entries.find(
      ([, f]) => {
        const fCfg = f.config ?? {};
        const fSection = fCfg.section
          ? studio?.sections?.find((s: { id: string }) => s.id === fCfg.section)
          : undefined;
        return (
          fCfg.section === cfg.section &&
          (!fCfg.section || isSectionVisible(fSection, values)) &&
          !f.hidden &&
          (!wizard || (fCfg.step ?? wizard.first) === wizard.active) &&
          (!fCfg.visibleWhen ||
            evaluateCondition(fCfg.visibleWhen as any, values))
        );
      },
    )?.[0] === name;
  const section = sectionDef;
  const resolvedLabel = resolveFieldLabel(field, locale);
  const label =
    field.type === R2_ATTACHMENT_TYPE && resolvedLabel === "Archivo R2"
      ? "Archivo adjunto"
      : resolvedLabel;
  return (
    <div
      hidden={!visible}
      {...(!visible ? { inert: true, "aria-hidden": true } : {})}
      className="studio-field-heading"
      data-hidden={!visible || undefined}
      data-wide={cfg.width === 2 || undefined}
      data-section-start={!!firstInSection || undefined}
    >
      {firstInSection &&
        section &&
        !(wizard?.activeTitle && section.label === wizard.activeTitle) && (
        <h3 className="studio-section-title">{section.label}</h3>
      )}
      <Label htmlFor={String(cfg.inputId ?? name)} id={`${cfg.inputId ?? name}_label`}>
        {label}
        {required ? (
          <span className="required" aria-hidden="true">
            {" "}
            *
          </span>
        ) : null}
      </Label>
      {field.description && (
        <p className="studio-field-help">{field.description}</p>
      )}
    </div>
  );
}

export type DynamicFormProps = {
  /** Keep a transient copy separate from the ordinary persisted create draft. */
  ephemeralDraft?: boolean;
  object: CrmObject;
  values?: Record<string, unknown>;
  onSave: (
    data: Record<string, unknown>,
    previous?: CrmRecord,
    relations?: RelatedRecordChanges[],
    options?: { idempotencyKey: string },
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
  onCancel?: () => void;
  onSaved?: (record: CrmRecord | void) => void;
  submitLabel?: string;
  formActions?: React.ReactNode;
  renderFieldActions?: (field: string) => React.ReactNode;
  onValuesChange?: (values: Record<string, unknown>) => void;
};
export type PendingAttachment = { field: string; files: File[] };
export type AttachmentUploadStatus = {
  field: string;
  file: File;
  status: "uploaded" | "uploading";
};
export default function DynamicForm(props: DynamicFormProps) {
  if (
    !Object.values(props.object.config.fields).some(field => field.config?.collectionRelationTarget && ["subform", "table"].includes(String(field.config?.relationPresentation))) &&
    props.object.config.studio?.wizard?.enabled &&
    props.object.config.studio.wizard.presentation !== "steps"
  )
    return <ConversationWizard {...props} />;
  return <StepForm {...props} />;
}
function StepForm({
  object,
  values = EMPTY_VALUES,
  onSave,
  onPersistAttachments,
  onUploadTemporaryAttachment,
  onPersistTemporaryAttachments,
  onDiscardTemporaryAttachments,
  onCancel,
  onSaved,
  submitLabel = "Guardar registro",
  formActions,
  renderFieldActions,
  onValuesChange,
}: {
  object: CrmObject;
  values?: Record<string, unknown>;
  onSave: (
    data: Record<string, unknown>,
    previous?: CrmRecord,
    relations?: RelatedRecordChanges[],
    options?: { idempotencyKey: string },
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
  onCancel?: () => void;
  onSaved?: (record: CrmRecord | void) => void;
  submitLabel?: string;
  formActions?: React.ReactNode;
  renderFieldActions?: (field: string) => React.ReactNode;
  onValuesChange?: (values: Record<string, unknown>) => void;
}) {
  const managedObject = ["managed-customer", "managed-agency"].includes(
    object.config.studio?.business ?? "",
  );
  const managedEdit = (managedObject || Boolean(object.config.studio?.collection)) && Boolean(values.id);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
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
  const [savedRecordId, setSavedRecordId] = useState(
    () => String(values.id ?? ""),
  );
  const [savedRecord, setSavedRecord] = useState<CrmRecord | undefined>();
  const steps = object.config.studio?.wizard?.enabled
    ? object.config.studio.wizard.steps
    : [];
  const [stepIndex, setStepIndex] = useState(0);
  const activeIndex = Math.min(stepIndex, Math.max(0, steps.length - 1));
  const activeStep = steps[activeIndex];
  const lastStep = !activeStep || activeIndex === steps.length - 1;
  const root = useRef<HTMLDivElement>(null),
    heading = useRef<HTMLHeadingElement>(null);
  const queuedAttachmentsRef = useRef<Record<string, File[]>>({});
  const temporaryAttachmentsRef = useRef<
    { field: string; file: File; attachment: TemporaryR2Attachment }[]
  >([]);
  const handledAttachmentsRef = useRef(new Set<File>());
  const cancelledRef = useRef(false);
  const discardTemporaryAttachmentsRef = useRef(
    onDiscardTemporaryAttachments,
  );
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
  const [focusField, setFocusField] = useState("");
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
        void onDiscardTemporaryAttachments(removed.map(({ attachment }) => attachment)).catch(
          (cause: Error) => setError(cause.message),
        );
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
  const hasPendingAttachmentUpload = Object.values(uploadingAttachments).some(
    Boolean,
  );
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
    setUploadingAttachments((previous) => ({ ...previous, [field]: undefined }));
    refreshAttachments(field, file);
  };
  useEffect(() => {
    if (activeStep) {
      if (focusField)
        root.current
          ?.querySelector<HTMLElement>(`[id="${focusField}"]`)
          ?.focus();
      else heading.current?.focus();
    }
  }, [activeIndex, focusField]);
  const goBack = (index: number) => {
    setStepIndex(index);
    setError("");
    setFieldErrors({});
    setFocusField("");
  };
  const cancel = async () => {
    cancelledRef.current = true;
    queuedAttachmentsRef.current = {};
    setQueuedAttachments({});
    const attachments = temporaryAttachmentsRef.current.map(
      ({ attachment }) => attachment,
    );
    try {
      if (attachments.length && onDiscardTemporaryAttachments)
        await onDiscardTemporaryAttachments(attachments);
      replaceTemporaryAttachments([]);
      onCancel?.();
    } catch (cause) {
      setError((cause as Error).message);
    }
  };
  // Shared validation owns required/conditional checks; form-engine remains the live form runtime.
  // Remote relations use their own runtime type: Dropdown clears IDs absent from its
  // local options catalog, which is incomplete by definition for paginated relations.
  const orderedFields = useMemo(() => [...fieldEntries(object)].sort((a, b) => {
    const sections = object.config.studio?.sections ?? [];
    const rank = (section: unknown) => section ? sections.findIndex(s => s.id === section) + 1 : 0;
    return rank(a[1].config?.section) - rank(b[1].config?.section);
  }), [object]);
  const config = useMemo(
    () => ({
      ...object.config,
      settings: {
        ...object.config.settings,
        manualSave: true,
        ...((managedObject || object.config.studio?.collection || object.config.studio?.requestPage)
          ? { expandCutoffCount: Object.keys(object.config.fields).length + 1 }
          : {}),
      },
      fieldOrder: orderedFields.map(([name]) => name),
      fields: Object.fromEntries(
        orderedFields.map(([name, field]) => [
          name,
          {
            ...field,
            type: field.config?.collectionRelationTarget ? "CrmCollectionRelation" : field.config?.relation ? "CrmRelation" : field.type,
            required: false,
            readOnly:
              field.readOnly ||
              !!field.config?.formula ||
              (managedEdit &&
                object.config.studio?.business === "managed-customer" &&
                name === "person_type"),
            config: {
              ...field.config,
              recordId: values.id ?? savedRecordId,
              studioObject: object,
            },
          },
        ]),
      ),
    }),
    [object, managedEdit, managedObject, savedRecordId, values.id, orderedFields],
  );
  const defaults = useMemo(() => {
    const initial = Object.fromEntries(
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
    );
    try {
      return prepareRecord(object, initial);
    } catch {
      return initial;
    }
  }, [object, values]);
  return (
    <div
      ref={root}
      className="dynamic-form studio-form"
      data-columns={(object.config as any).studio?.columns ?? 1}
    >
      {activeStep && (
        <div className="wizard-header">
          <nav aria-label="Pasos del formulario">
            <ol className="wizard-steps">
              {steps.map((step, index) => {
                const label = (
                  <>
                    <span className="wizard-step-number" aria-hidden="true">
                      {index < activeIndex ? <Check size={14} /> : index + 1}
                    </span>
                    <span>{step.title}</span>
                  </>
                );
                return (
                  <li key={step.id}>
                    {index < activeIndex ? (
                      <button
                        type="button"
                        className="wizard-step wizard-step-complete"
                        disabled={busy}
                        onClick={() => goBack(index)}
                      >
                        {label}
                      </button>
                    ) : index === activeIndex ? (
                      <span
                        className="wizard-step wizard-step-current"
                        aria-current="step"
                      >
                        {label}
                      </span>
                    ) : (
                      <span
                        className="wizard-step wizard-step-upcoming"
                        aria-disabled="true"
                      >
                        {label}
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          </nav>
          <h3 ref={heading} tabIndex={-1} className="sr-only">
            Paso {activeIndex + 1} de {steps.length}: {activeStep.title}
          </h3>
          {activeStep.description && (
            <p className="studio-field-help wizard-step-description">
              {activeStep.description}
            </p>
          )}
        </div>
      )}
      <WizardContext.Provider
        value={
          activeStep
            ? {
                active: activeStep.id,
                first: steps[0].id,
                activeTitle: activeStep.title,
              }
            : null
        }
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
            <InjectedFieldProvider injectedFields={wizardRegistry(object)}>
            <FormEngine
              configName={`${object.name}-${values.id ?? "new"}`}
              programName="savia-crm"
              formConfig={config}
              defaultValues={defaults as IEntityData}
              entityType={object.name}
              entityId={String(values.id ?? "new")}
              isCreate={!values.id}
              isManualSave
              renderSaveButton={() => null}
              renderLabel={({ id }) => <><FieldLabel object={object} name={id} />{renderFieldActions?.(id)}</>}
              renderStatus={() => <FormValuesObserver onChange={onValuesChange} />}
              renderError={({ id, error: runtimeError }) =>
                fieldErrors[id] || runtimeError ? (
                  <p
                    hidden={
                      !!activeStep &&
                      (object.config.fields[id]?.config?.step ??
                        steps[0].id) !== activeStep.id
                    }
                    id={`${id}_error`}
                    role="alert"
                  >
                    {fieldErrors[id] ??
                      runtimeError?.message ??
                      "Revisa este campo"}
                  </p>
                ) : null
              }
              onSubmit={async (data) => {
                setError("");
                setFieldErrors({});
                try {
                  const related = Object.entries(object.config.fields).filter(
                    ([, field]) =>
                      field.config?.collectionRelationTarget &&
                      ["subform", "table"].includes(
                        String(field.config?.relationPresentation),
                      ),
                  );
                  // Validate required relation selections as IDs, then preserve staged rows.
                  const validationData = { ...data };
                  for (const [name, field] of related) {
                    const rows = Array.isArray(data[name])
                      ? (data[name] as unknown[])
                      : [];
                    validationData[name] = field.config?.multiple
                      ? rows.map((_, index) => String(index))
                      : rows.length
                        ? "selected"
                        : "";
                  }
                  const result = validateRecord(object, validationData);
                  for (const [name] of related)
                    result.data[name] = data[name];
                  for (const [name] of related) {
                    const invalid = Array.isArray(data[name]) && (data[name] as Array<{__errors?:string[]}>).some(row=>row.__errors?.length);
                    if(invalid) result.errors[name] = "Revisa los campos del registro relacionado antes de guardar.";
                  }
                  const changedFields = managedEdit
                    ? new Set(
                        Object.keys(object.config.fields).filter(
                          (name) =>
                            JSON.stringify(data[name]) !==
                            JSON.stringify(defaults[name]),
                        ),
                      )
                    : undefined;
                  const relevantErrors = Object.fromEntries(
                    Object.entries(result.errors).filter(
                      ([name]) =>
                        (!changedFields ||
                          name === "_form" ||
                          changedFields.has(name)) &&
                        (lastStep ||
                          name === "_form" ||
                          (object.config.fields[name]?.config?.step ??
                            steps[0]?.id) === activeStep?.id),
                    ),
                  );
                  if (Object.keys(relevantErrors).length) {
                    setFieldErrors(relevantErrors);
                    setError(
                      activeStep
                        ? "Revisa los campos señalados antes de continuar."
                        : "Revisa los campos señalados antes de guardar.",
                    );
                    const firstError = fieldEntries(object).find(
                      ([name]) => relevantErrors[name],
                    )?.[0];
                    if (firstError) {
                      if (activeStep && lastStep) {
                        const destination = steps.findIndex(
                          (step) =>
                            step.id ===
                            object.config.fields[firstError]?.config?.step,
                        );
                        if (destination >= 0) setStepIndex(destination);
                      }
                      setFocusField(firstError);
                    }
                    return;
                  }
                  if (activeStep && !lastStep) {
                    setStepIndex(activeIndex + 1);
                    setFocusField("");
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
                  if (
                    onUploadTemporaryAttachment &&
                    queuedCount !== temporary.length
                  ) {
                    setError(
                      "Revisa los archivos antes de guardar. Uno o más no se pudieron cargar.",
                    );
                    return;
                  }
                  setBusy(true);
                  const attachments = fieldEntries(object).flatMap(
                    ([field, definition]) =>
                      definition.type === R2_ATTACHMENT_TYPE &&
                      queuedAttachments[field]?.length
                        ? [{ field, files: queuedAttachments[field] }]
                        : [],
                  );
                  const recordData = changedFields
                    ? Object.fromEntries(
                        Object.entries(result.data).filter(([name]) =>
                          changedFields.has(name),
                        ),
                      )
                    : result.data;
                  const saved = savedRecord
                    ? await onSave(recordData, savedRecord)
                    : await onSave(recordData);
                  if (saved) {
                    setSavedRecord(saved);
                    setSavedRecordId(saved.id);
                  }
                  if (temporary.length) {
                    if (!saved || !onPersistTemporaryAttachments)
                      throw new Error(
                        "No se pudieron asociar los archivos al registro. Inténtalo de nuevo.",
                      );
                    await onPersistTemporaryAttachments(saved, temporary);
                    queuedAttachmentsRef.current = {};
                    setQueuedAttachments({});
                    replaceTemporaryAttachments([]);
                    setAttachmentVersion((version) => version + 1);
                  } else if (attachments.length) {
                    if (!saved || !onPersistAttachments)
                      throw new Error(
                        "No se pudieron preparar los archivos para R2. Guarda el registro e inténtalo de nuevo.",
                      );
                    await onPersistAttachments(
                      saved,
                      attachments,
                      updateAttachmentStatus,
                    );
                  }
                  onSaved?.(saved);
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                  setUploadingAttachments({});
                }
              }}
              renderSubmitButton={({ onSubmit, isSubmitting }) => (
                <div
                  className={
                    "wizard-actions" +
                    (!activeStep ? " standard-form-actions" : "")
                  }
                >
                  {formActions}
                  {!activeStep && onCancel && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy || isSubmitting}
                      onClick={() => void cancel()}
                    >
                      Cancelar
                    </Button>
                  )}
                  {activeStep && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy || isSubmitting || activeIndex === 0}
                      onClick={() => goBack(activeIndex - 1)}
                    >
                      <ArrowLeft size={14} aria-hidden="true" />
                      Anterior
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    onClick={onSubmit}
                    disabled={busy || isSubmitting || hasPendingAttachmentUpload}
                    className="form-submit"
                  >
                    {busy ? (
                      <LoaderCircle
                        className="animate-spin"
                        size={14}
                        aria-hidden="true"
                      />
                    ) : lastStep ? (
                      <Save size={14} aria-hidden="true" />
                    ) : (
                      <ArrowRight size={14} aria-hidden="true" />
                    )}
                    {busy
                      ? "Guardando…"
                      : lastStep
                        ? submitLabel
                        : "Siguiente paso"}
                  </Button>
                  {activeStep && (
                    <p className="wizard-save-note">
                      Se guardará al completar el último paso.
                    </p>
                  )}
                </div>
              )}
              />
            </InjectedFieldProvider>
          </RulesEngineProvider>
        </AttachmentQueueProvider>
      </WizardContext.Provider>
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
