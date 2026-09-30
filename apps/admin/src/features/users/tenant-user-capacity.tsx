import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "ra-core";
import {
  MAX_ACTIVE_USER_LIMIT,
  TenantUserCapacityClient,
} from "@/api/tenant-user-capacity-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAppServices } from "@/features/assistant/assistant-context";

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
  const [validationError, setValidationError] = useState("");
  useEffect(() => {
    const limit = capacity.data?.maxActiveUsers;
    setDraft(limit === null || limit === undefined ? "" : String(limit));
  }, [capacity.data?.maxActiveUsers]);

  const save = useMutation({
    mutationFn: (maxActiveUsers: number | null) =>
      new TenantUserCapacityClient(apiClient).set(tenantId!, maxActiveUsers),
    onSuccess: (result) => {
      queryClient.setQueryData(key, result);
      setValidationError("");
    },
  });

  if (!validTenantId) return null;

  const submit = () => {
    const limit = draft.trim() === "" ? null : Number(draft);
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
      aria-labelledby="tenant-user-capacity-title"
      className="mb-4 grid gap-3 border-b pb-4 sm:grid-cols-[minmax(0,1fr)_minmax(16rem,auto)] sm:items-end"
    >
      <div className="space-y-1">
        <h2 id="tenant-user-capacity-title" className="text-sm font-medium">
          {t("savia.users.capacity.title", "Tenant user capacity")}
        </h2>
        {capacity.isPending ? (
          <p role="status" className="text-sm text-muted-foreground">
            {t("savia.users.capacity.loading", "Loading active-user count…")}
          </p>
        ) : capacity.error ? (
          <div role="alert" className="space-y-2 text-sm text-destructive">
            <p>
              {t(
                "savia.users.capacity.loadError",
                "Unable to load tenant user capacity.",
              )}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void capacity.refetch()}
            >
              {t("savia.users.capacity.retry", "Retry")}
            </Button>
          </div>
        ) : (
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
        )}
      </div>

      {platformCanEdit && !capacity.error && !capacity.isPending && (
        <div className="grid gap-2 sm:grid-cols-[minmax(9rem,1fr)_auto] sm:items-end">
          <div className="grid gap-1.5">
            <Label htmlFor={`tenant-user-capacity-${tenantId}`}>
              {t("savia.users.capacity.limitLabel", "Maximum active users")}
            </Label>
            <Input
              id={`tenant-user-capacity-${tenantId}`}
              type="number"
              min={0}
              max={MAX_ACTIVE_USER_LIMIT}
              step={1}
              inputMode="numeric"
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                setValidationError("");
              }}
              aria-invalid={Boolean(validationError)}
              aria-describedby={
                validationError
                  ? `tenant-user-capacity-error-${tenantId}`
                  : `tenant-user-capacity-help-${tenantId}`
              }
              disabled={save.isPending}
            />
            <p
              id={`tenant-user-capacity-help-${tenantId}`}
              className="text-xs text-muted-foreground"
            >
              {t(
                "savia.users.capacity.unlimitedHelp",
                "Leave blank for no limit. The count includes tenant administrators.",
              )}
            </p>
            {validationError && (
              <p
                id={`tenant-user-capacity-error-${tenantId}`}
                role="alert"
                className="text-xs text-destructive"
              >
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
          <Button
            type="button"
            onClick={submit}
            disabled={
              save.isPending || capacity.isPending || Boolean(capacity.error)
            }
          >
            {save.isPending
              ? t("savia.users.capacity.saving", "Saving…")
              : t("savia.users.capacity.save", "Save limit")}
          </Button>
        </div>
      )}
    </section>
  );
}
