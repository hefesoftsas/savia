import { useMessages } from "@/i18n/core";
import { accessMessages } from "@/i18n/locales/access";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { AccessCatalog, RoleInput } from "@/api/access-control-client";
import type { AccessPredicate } from "@savia/studio-shared/access-control";
type Grant = RoleInput["grants"][number];
const emptyCondition = (): AccessPredicate => ({
  field: "",
  op: "eq",
  value: { literal: "" },
});
const selectClass =
  "h-9 rounded-md border bg-background px-2 text-sm focus-visible:ring-2 focus-visible:ring-ring";
export function PredicateEditor({
  value,
  onChange,
  entry,
}: {
  value: AccessPredicate;
  onChange: (p: AccessPredicate) => void;
  entry: AccessCatalog[number];
}) {
  const t = useMessages(accessMessages);
  const mode =
    "all" in value
      ? "all"
      : "and" in value
        ? "and"
        : "or" in value
          ? "or"
          : value.field === "$createdBy"
            ? "own"
            : "condition";
  return (
    <div className="space-y-2">
      <select
        aria-label={t("Record scope")}
        className={selectClass}
        value={mode}
        onChange={(e) => {
          const m = e.target.value;
          onChange(
            m === "all"
              ? { all: true }
              : m === "own"
                ? {
                    field: "$createdBy",
                    op: "eq",
                    value: { variable: "principalId" },
                  }
                : m === "and"
                  ? { and: [emptyCondition()] }
                  : m === "or"
                    ? { or: [emptyCondition()] }
                    : {
                        field: "",
                        op: "eq",
                        value: { literal: "" },
                      },
          );
        }}
      >
        <option value="all">{t("All records")}</option>
        {entry.creatorSupported && (
          <option value="own">{t("Created by the user")}</option>
        )}
        <option value="condition">{t("Matching a condition")}</option>
        <option value="and">{t("All conditions match")}</option>
        <option value="or">{t("Any condition matches")}</option>
      </select>
      {("and" in value || "or" in value) && (
        <div className="ml-3 space-y-3 border-l pl-3">
          {("and" in value ? value.and : value.or).map((p, i) => (
            <div key={i} className="flex flex-wrap items-start gap-2">
              <PredicateEditor
                entry={entry}
                value={p}
                onChange={(next) => {
                  const children = [...("and" in value ? value.and : value.or)];
                  children[i] = next;
                  onChange(
                    "and" in value ? { and: children } : { or: children },
                  );
                }}
              />
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  const children = (
                    "and" in value ? value.and : value.or
                  ).filter((_, n) => n !== i);
                  onChange(
                    children.length
                      ? "and" in value
                        ? { and: children }
                        : { or: children }
                      : emptyCondition(),
                  );
                }}
              >
                {t("Remove condition")}
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              onChange(
                "and" in value
                  ? { and: [...value.and, emptyCondition()] }
                  : { or: [...value.or, emptyCondition()] },
              )
            }
          >
            {t("Add condition")}
          </Button>
        </div>
      )}
      {mode === "condition" && "field" in value && (
        <div className="flex flex-wrap gap-2">
          <select
            aria-label={t("Condition field")}
            className={selectClass}
            value={value.field}
            onChange={(e) =>
              onChange({
                field: e.target.value,
                op: "eq",
                value: { literal: "" },
              })
            }
          >
            <option value="">{t("Choose a field")}</option>
            {entry.fields.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
          <select
            aria-label={t("Comparison")}
            className={selectClass}
            value={value.op}
            onChange={(e) =>
              onChange({
                field: value.field,
                op: e.target.value as "eq",
                value: { literal: "" },
              })
            }
          >
            <option value="eq">{t("equals")}</option>
            <option value="lt">{t("less than")}</option>
            <option value="lte">{t("at most")}</option>
            <option value="gt">{t("greater than")}</option>
            <option value="gte">{t("at least")}</option>
          </select>
          <Input
            aria-label={t("Condition value")}
            className="w-40"
            value={
              "value" in value && "literal" in value.value
                ? String(value.value.literal ?? "")
                : ""
            }
            onChange={(e) =>
              onChange({
                field: value.field,
                op: value.op === "in" ? "eq" : value.op,
                value: {
                  literal: [
                    "Number",
                    "Currency",
                    "Percentage",
                    "Rating",
                  ].includes(entry.fieldTypes[value.field])
                    ? Number(e.target.value)
                    : e.target.value,
                },
              })
            }
          />
        </div>
      )}
    </div>
  );
}
export function GrantEditor({
  entry,
  grants,
  onChange,
}: {
  entry: AccessCatalog[number];
  grants: Grant[];
  onChange: (grants: Grant[]) => void;
}) {
  const t = useMessages(accessMessages);
  return (
    <section className="space-y-4 border-t py-5">
      <div>
        <h3 className="font-medium">{entry.label}</h3>
        {entry.restricted && (
          <p className="text-sm text-muted-foreground">
            {t(
              "This source does not support configurable permissions. Its existing access rules remain in effect.",
            )}
          </p>
        )}
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-3">
        {entry.actions.map((action) => (
          <label
            key={
              action in accessMessages
                ? t(action as keyof typeof accessMessages)
                : action
            }
            className="flex items-center gap-2 text-sm"
          >
            <input
              type="checkbox"
              checked={grants.some((g) => g.action === action)}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? [
                        ...grants,
                        {
                          resource: entry.resource,
                          action,
                          predicate: { all: true },
                          fields: [],
                        },
                      ]
                    : grants.filter((g) => g.action !== action),
                )
              }
            />
            {action in accessMessages
              ? t(action as keyof typeof accessMessages)
              : action}
          </label>
        ))}
      </div>
      {grants.map((grant, index) => (
        <div key={index} className="space-y-3 rounded-md bg-muted/40 p-4">
          <h4 className="text-sm font-medium">
            {grant.action in accessMessages
              ? t(grant.action as keyof typeof accessMessages)
              : grant.action}
          </h4>
          {entry.resource.startsWith("collection:") && (
            <PredicateEditor
              entry={entry}
              value={grant.predicate as AccessPredicate}
              onChange={(predicate) =>
                onChange(
                  grants.map((g, i) =>
                    i === index
                      ? { ...g, predicate: predicate as Grant["predicate"] }
                      : g,
                  ),
                )
              }
            />
          )}
          {entry.fields.length > 0 && (
            <fieldset>
              <legend className="mb-2 text-sm">{t("Allowed fields")}</legend>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {entry.fields.map((field) => (
                  <label
                    key={field}
                    className="flex items-center gap-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={grant.fields.includes(field)}
                      onChange={(e) =>
                        onChange(
                          grants.map((g, i) =>
                            i === index
                              ? {
                                  ...g,
                                  fields: e.target.checked
                                    ? [...g.fields, field]
                                    : g.fields.filter((f) => f !== field),
                                }
                              : g,
                          ),
                        )
                      }
                    />
                    {field}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
        </div>
      ))}
    </section>
  );
}
