import { useState } from "react";
import { useTranslate } from "ra-core";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  notificationClient,
  type NotificationClient,
} from "./client";
import { useUnreadNotifications } from "./queries";

export function NotificationBell({
  client = notificationClient,
}: {
  client?: NotificationClient;
}) {
  const [open, setOpen] = useState(false);
  const translate = useTranslate();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const unread = useUnreadNotifications(client);
  const count = typeof unread.data === "number" ? unread.data : 0;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          void queryClient.invalidateQueries({ queryKey: ["notifications"] });
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="relative size-8"
          aria-label={
            count > 0
              ? `${translate("savia.notificationInbox.title")} (${count})`
              : translate("savia.notificationInbox.title")
          }
          title={translate("savia.notificationInbox.title")}
        >
          <Bell aria-hidden="true" size={17} />
          {count > 0 && (
            <span
              aria-hidden="true"
              className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground"
            >
              {count > 99 ? "99+" : count}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-2">
        <p className="px-2 py-1 text-sm font-medium">
          {count === 0 ? translate("savia.notificationInbox.noNew") : translate("savia.notificationInbox.unread")}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-full justify-start"
          onClick={() => {
            setOpen(false);
            navigate("/notifications");
          }}
        >
          {translate("savia.notificationInbox.openInbox")}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
