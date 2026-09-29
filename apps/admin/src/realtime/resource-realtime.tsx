import { useQueryClient } from "@tanstack/react-query";
import { useFormContext, useFormState } from "react-hook-form";
import {
  useRealtimeRefresh,
  RemoteChangesNotice,
} from "./use-realtime-refresh";

export function ResourceReadSync({
  resource,
}: {
  resource: "users" | "tenants";
}) {
  const cache = useQueryClient();
  useRealtimeRefresh({
    topics: [resource],
    refresh: () => cache.invalidateQueries({ queryKey: [resource] }),
  });
  return null;
}
export function ResourceEditSync({
  resource,
}: {
  resource: "users" | "tenants";
}) {
  const cache = useQueryClient();
  const form = useFormContext();
  const { isDirty, isSubmitting } = useFormState();
  const remote = useRealtimeRefresh({
    topics: [resource],
    blocked: isDirty || isSubmitting,
    refresh: async () => {
      await cache.invalidateQueries({ queryKey: [resource] });
    },
  });
  return (
    <RemoteChangesNotice
      changed={remote.changed}
      reload={async () => {
        form.reset();
        await remote.reload();
      }}
    />
  );
}
