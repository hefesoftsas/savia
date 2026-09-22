import { useState } from "react";
import { useTranslate } from "ra-core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  notificationClient,
  type NotificationClient,
} from "./client";

export function CollectionFollow({
  collection,
  client = notificationClient,
}: {
  collection: string;
  client?: NotificationClient;
}) {
  const translate = useTranslate();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const follows = useQuery({
    queryKey: ["notifications", "follows"],
    queryFn: () => client.follows(),
  });
  const following = follows.data?.includes(collection) ?? false;

  const toggle = async () => {
    setBusy(true);
    setError("");
    try {
      if (following) await client.unfollow(collection);
      else await client.follow(collection);
      await queryClient.invalidateQueries({ queryKey: ["notifications", "follows"] });
    } catch {
      setError(translate("savia.notificationInbox.actionError"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="inline-flex items-center gap-1">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={busy || follows.isPending}
        aria-pressed={following}
        onClick={() => void toggle()}
      >
        {following
          ? translate("savia.notificationInbox.unfollow")
          : translate("savia.notificationInbox.follow")}
      </Button>
      {error && <span role="alert">{error}</span>}
    </span>
  );
}
