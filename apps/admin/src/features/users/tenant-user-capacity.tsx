import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "ra-core";
import { RotateCcw, Save } from "lucide-react";
import {
  MAX_ACTIVE_USER_LIMIT,
  TenantUserCapacityClient,
} from "@/api/tenant-user-capacity-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ReadRefreshStatus } from "@/components/admin/read-refresh-status";
import { isReadAccessDenied } from "@/queries/read-state";
import { useAppServices } from "@/features/assistant/assistant-context";
import "./tenant-user-capacity.css";

export function TenantUserCapacity({
  tenantId,
  platformCanEdit,
}: {
  tenantId?: number | null;
  platformCanEdit: boolean;
}) {
  const translate = useTranslate();
  const { apiClient } = useAppServices();
  const queryClient = useQueryClient();
  const validTenantId =
    typeof tenantId === "number" &&
    Number.isSafeInteger(tenantId) &&
    tenantId > 0;
  const key = ["tenant-user-capacity", validTenantId ? tenantId : null];
  const capacity = useQuery({
    queryKey: key,
    enabled: validTenantId,
    queryFn: () => new TenantUserCapacityClient(apiClient).get(tenantId!),
  });
  const [draft, setDraft] = useState("");
  const [draftTenantId, setDraftTenantId] = useState<number | null | undefined>(
    tenantId,
  );
  const [draftDirty, setDraftDirty] = useState(false);
  const [validationError, setValidationError] = useState("");
  const currentDraft = draftTenantId === tenantId ? draft : "";
  const accessDenied = isReadAccessDenied(capacity.error);
  useEffect(() => {
    if (draftTenantId === tenantId && draftDirty) return;
    const limit = capacity.data?.maxActiveUsers;
    setDraft(limit === null || limit === undefined ? "" : String(limit));
    setDraftTenantId(tenantId);
    setDraftDirty(false);
  }, [capacity.data?.maxActiveUsers, draftDirty, draftTenantId, tenantId]);

  const save = useMutation({
    mutationFn: (maxActiveUsers: number | null) =>
      new TenantUserCapacityClient(apiClient).set(tenantId!, maxActiveUsers),
    onSuccess: (result) => {
      const limit = result.maxActiveUsers;
      setDraft(limit === null || limit === undefined ? "" : String(limit));
      setDraftTenantId(tenantId);
      setDraftDirty(false);
      queryClient.setQueryData(key, result);
      setValidationError("");
    },
  });

  if (!validTenantId) return null;

  const titleId = `tenant-user-capacity-title-${tenantId}`;
  const inputId = `tenant-user-capacity-${tenantId}`;
  const helpId = `tenant-user-capacity-help-${tenantId}`;
  const errorId = `tenant-user-capacity-error-${tenantId}`;

  const submit = () => {
    const limit = currentDraft.trim() === "" ? null : Number(currentDraft);
    if (
      limit !== null &&
      (!Number.isSafeInteger(limit) ||
        limit < 0 ||
        limit > MAX_ACTIVE_USER_LIMIT)
    ) {
      setValidationError(
        translate("savia.users.capacity.invalidLimit", {
          _: "Enter a whole number from 0 to 2,147,483,647 or leave the limit blank.",
        }),
      );
      return;
    }
    setValidationError("");
    save.mutate(limit);
  };

  const t = (key: string, fallback: string) => translate(key, { _: fallback });

  return (
    <section
      aria-labelledby={titleId}
      className="mb-4 grid w-full min-w-0 gap-3 border-b pb-4"
    >
      <div className="min-w-0 space-y-1">
        <h2 id={titleId} className="text-sm font-medium">
          {t("savia.users.capacity.title", "Tenant user capacity")}
        </h2>
        {capacity.isPending ? (
          <p role="status" className="text-sm text-muted-foreground">
            {t("savia.users.capacity.loading", "Loading active-user count…")}
          </p>
        ) : capacity.error && (!capacity.data || accessDenied) ? (
          <div role="alert" className="space-y-2 text-sm text-destructive">
            <p>
              {t(
                "savia.users.capacity.loadError",
                "Unable to load tenant user capacity.",
              )}
            </p>
            {!accessDenied && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="max-sm:size-11 max-sm:p-0 max-sm:has-[>svg]:px-0"
                onClick={() => void capacity.refetch()}
              >
                <RotateCcw aria-hidden="true" />
                <span className="sr-only sm:not-sr-only">
                  {t("savia.users.capacity.retry", "Retry")}
                </span>
              </Button>
            )}
          </div>
        ) : capacity.data && !accessDenied ? (
          <p className="text-sm text-muted-foreground">
            {capacity.data?.maxActiveUsers === null
              ? translate("savia.users.capacity.unlimitedCount", {
                  activeUsers: capacity.data.activeUsers,
                  _: `${capacity.data.activeUsers} active users · Unlimited`,
                })
              : translate("savia.users.capacity.limitedCount", {
                  activeUsers: capacity.data?.activeUsers ?? 0,
                  maxActiveUsers: capacity.data?.maxActiveUsers ?? 0,
                  _: `${capacity.data?.activeUsers ?? 0} / ${capacity.data?.maxActiveUsers ?? 0} active users`,
                })}
          </p>
        ) : null}
        {capacity.data && !accessDenied && (
          <ReadRefreshStatus
            refreshing={capacity.isFetching}
            error={
              capacity.error
                ? t(
                    "savia.users.capacity.loadError",
                    "Unable to load tenant user capacity.",
                  )
                : undefined
            }
            onRetry={() => void capacity.refetch()}
          />
        )}
      </div>

      {platformCanEdit &&
        capacity.data &&
        !capacity.isPending &&
        !accessDenied && (
          <div className="tenant-user-capacity-editor grid w-full min-w-0 max-w-xl gap-2">
            <div className="tenant-user-capacity-controls grid min-w-0 gap-2">
              <div className="grid min-w-0 gap-1.5">
                <Label htmlFor={inputId}>
                  {t("savia.users.capacity.limitLabel", "Maximum active users")}
                </Label>
                <Input
                  id={inputId}
                  type="number"
                  min={0}
                  max={MAX_ACTIVE_USER_LIMIT}
                  step={1}
                  inputMode="numeric"
                  value={currentDraft}
                  onChange={(event) => {
                    setDraft(event.target.value);
                    setDraftTenantId(tenantId);
                    setDraftDirty(true);
                    setValidationError("");
                  }}
                  aria-invalid={Boolean(validationError)}
                  aria-describedby={validationError ? errorId : helpId}
                  disabled={save.isPending}
                />
              </div>
              <Button
                type="button"
                className="max-sm:size-11 max-sm:p-0 max-sm:has-[>svg]:px-0"
                onClick={submit}
                disabled={
                  save.isPending || capacity.isPending || !capacity.data
                }
              >
                <Save aria-hidden="true" />
                <span className="sr-only sm:not-sr-only">
                  {save.isPending
                    ? t("savia.users.capacity.saving", "Saving…")
                    : t("savia.users.capacity.save", "Save limit")}
                </span>
              </Button>
            </div>
            <p id={helpId} className="text-xs text-muted-foreground">
              {t(
                "savia.users.capacity.unlimitedHelp",
                "Leave blank for no limit. The count includes tenant administrators.",
              )}
            </p>
            {validationError && (
              <p id={errorId} role="alert" className="text-xs text-destructive">
                {validationError}
              </p>
            )}
            {save.error && !validationError && (
              <p role="alert" className="text-xs text-destructive">
                {t(
                  "savia.users.capacity.saveError",
                  "Unable to save the user limit.",
                )}
              </p>
            )}
            {save.isSuccess && !save.isPending && (
              <p role="status" className="text-xs text-muted-foreground">
                {t("savia.users.capacity.saved", "User limit saved.")}
              </p>
            )}
          </div>
        )}
    </section>
  );
}
