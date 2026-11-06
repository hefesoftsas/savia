import { useState, type FormEvent } from "react";
import { LoaderCircle, Pencil, RefreshCw, Trash2 } from "lucide-react";
import {
  calendarColors,
  calendarTimeZoneSchema,
  type CalendarSource,
} from "@savia/studio-shared/calendar-contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { CalendarSourcesState } from "./use-calendar-sources";
import { useAppLocale, useMessages, intlLocale } from "@/i18n/core";
import { calendarMessages } from "./calendar-messages";

const webcalPlaceholder = "webcal://…";

const colorMessageKeys = {
  blue: "Blue",
  emerald: "Green",
  violet: "Violet",
  amber: "Amber",
  rose: "Rose",
  slate: "Gray",
} as const;
function ColorSelect({
  value,
  onChange,
  id,
}: {
  value: CalendarSource["color"];
  onChange: (value: CalendarSource["color"]) => void;
  id: string;
}) {
  const t = useMessages(calendarMessages);
  return (
    <select
      id={id}
      value={value}
      onChange={(event) =>
        onChange(event.target.value as CalendarSource["color"])
      }
      className="h-9 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {calendarColors.map((color) => (
        <option key={color} value={color}>
          {t(colorMessageKeys[color])}
        </option>
      ))}
    </select>
  );
}
function SourceRow({
  source,
  state,
  run,
  busy,
}: {
  source: CalendarSource;
  state: CalendarSourcesState;
  run: (action: () => Promise<unknown>) => Promise<boolean>;
  busy: boolean;
}) {
  const t = useMessages(calendarMessages);
  const locale = intlLocale(useAppLocale());
  const [editing, setEditing] = useState(false),
    [name, setName] = useState(source.name),
    [color, setColor] = useState(source.color);
  return (
    <li className="space-y-3 py-4">
      <div className="flex flex-wrap items-start gap-3">
        <input
          type="checkbox"
          aria-label={t("Show %{name}", { name: source.name })}
          checked={source.visible}
          disabled={busy}
          onChange={(event) =>
            void run(() =>
              state.updateSource(source.id, { visible: event.target.checked }),
            )
          }
          className="mt-1 size-4 accent-primary"
        />
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-medium">{source.name}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {source.kind === "import" ? t("Imported copy") : t("Subscription")}
            {source.hostname ? ` · ${source.hostname}` : ""}
          </p>
          {source.lastSyncedAt ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {t("Updated: %{date}", {
                date: new Date(source.lastSyncedAt).toLocaleString(locale),
              })}
            </p>
          ) : null}
        </div>
        <div className="flex gap-1">
          {source.kind === "subscription" ? (
            <Button
              variant="ghost"
              size="icon"
              disabled={busy}
              aria-label={t("Refresh %{name}", { name: source.name })}
              onClick={() => void run(() => state.refreshSource(source.id))}
            >
              <RefreshCw className="size-4" />
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="icon"
            disabled={busy}
            aria-label={t("Edit %{name}", { name: source.name })}
            onClick={() => {
              setName(source.name);
              setColor(source.color);
              setEditing(!editing);
            }}
          >
            <Pencil className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            disabled={busy}
            aria-label={t("Delete %{name}", { name: source.name })}
            onClick={() => void run(() => state.removeSource(source.id))}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>
      {editing ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={async (event) => {
            event.preventDefault();
            if (await run(() => state.updateSource(source.id, { name, color })))
              setEditing(false);
          }}
        >
          <div className="min-w-40 flex-1 space-y-1">
            <Label htmlFor={`name-${source.id}`}>{t("Name")}</Label>
            <Input
              id={`name-${source.id}`}
              value={name}
              maxLength={100}
              required
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`color-${source.id}`}>{t("Color")}</Label>
            <ColorSelect
              id={`color-${source.id}`}
              value={color}
              onChange={setColor}
            />
          </div>
          <Button size="sm" disabled={busy}>
            {t("Save")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setEditing(false)}
          >
            {t("Cancel")}
          </Button>
        </form>
      ) : null}
    </li>
  );
}
async function fileText(file: File): Promise<string> {
  if (typeof file.text === "function") return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsText(file, "UTF-8");
  });
}
export function CalendarSourceManager({
  state,
  providers,
  timeZone,
  onClose,
}: {
  state: CalendarSourcesState;
  providers: string[];
  timeZone: string;
  onClose: () => void;
}) {
  const t = useMessages(calendarMessages);
  const [kind, setKind] = useState<"subscription" | "import">("subscription");
  const [name, setName] = useState(""),
    [url, setUrl] = useState(""),
    [zone, setZone] = useState(timeZone),
    [color, setColor] = useState<CalendarSource["color"]>("blue"),
    [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<keyof typeof calendarMessages | null>(null),
    [success, setSuccess] = useState<keyof typeof calendarMessages | null>(
      null,
    ),
    [fileKey, setFileKey] = useState(0);
  async function run(action: () => Promise<unknown>): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await action();
      return true;
    } catch {
      setError("Could not save changes");
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!calendarTimeZoneSchema.safeParse(zone).success) {
      setError("Enter a valid time zone");
      return;
    }
    if (kind === "import" && (!file || file.size > 1048576)) {
      setError("Choose an ICS file up to 1 MiB");
      return;
    }
    const saved = await run(async () => {
      const input =
        kind === "subscription"
          ? { kind, name, url, timeZone: zone, color }
          : {
              kind,
              name,
              content: await fileText(file!),
              timeZone: zone,
              color,
            };
      await state.addSource(input);
    });
    if (saved) {
      setName("");
      setUrl("");
      setFile(null);
      setFileKey((value) => value + 1);
      setSuccess("Calendar added");
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("Manage calendars")}</DialogTitle>
          <DialogDescription>
            {t("Subscription copy or import instructions")}
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {t(error)}
          </p>
        ) : null}
        {success ? (
          <p role="status" className="text-sm">
            {t(success)}
          </p>
        ) : null}
        {providers.length ? (
          <div className="space-y-2 border-b pb-4">
            {providers.map((provider) => (
              <label key={provider} className="flex items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={
                    state.preferences[
                      provider as keyof typeof state.preferences
                    ]
                  }
                  disabled={busy || !state.available}
                  onChange={(event) =>
                    void run(() =>
                      state.savePreferences({
                        ...state.preferences,
                        [provider]: event.target.checked,
                      }),
                    )
                  }
                />
                {provider === "outlook" ? t("Outlook") : t("Google Calendar")}
              </label>
            ))}
          </div>
        ) : null}
        {state.sources.length ? (
          <ul className="divide-y">
            {state.sources.map((source) => (
              <SourceRow
                key={source.id}
                source={source}
                state={state}
                run={run}
                busy={busy}
              />
            ))}
          </ul>
        ) : (
          <p className="py-2 text-sm text-muted-foreground">
            {t("No shared calendars yet")}
          </p>
        )}
        {state.available ? (
          <form onSubmit={submit} className="space-y-4 border-t pt-4">
            <h3 className="text-sm font-semibold">{t("Add calendar")}</h3>
            <div className="flex gap-2">
              {(["subscription", "import"] as const).map((value) => (
                <Button
                  key={value}
                  type="button"
                  size="sm"
                  variant={kind === value ? "secondary" : "ghost"}
                  aria-pressed={kind === value}
                  onClick={() => {
                    setKind(value);
                    setError(null);
                  }}
                >
                  {value === "subscription"
                    ? t("Subscription link")
                    : t("ICS file")}
                </Button>
              ))}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="calendar-source-name">{t("Calendar name")}</Label>
              <Input
                id="calendar-source-name"
                required
                maxLength={100}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t("Team, holidays…")}
              />
            </div>
            {kind === "subscription" ? (
              <div className="space-y-1.5">
                <Label htmlFor="calendar-source-url">
                  {t("HTTPS or WebCal link")}
                </Label>
                <Input
                  id="calendar-source-url"
                  required
                  maxLength={4096}
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder={webcalPlaceholder}
                />
                <p className="text-xs text-muted-foreground">
                  {t("Subscription help")}
                </p>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="calendar-source-file">
                  {t("Calendar file")}
                </Label>
                <Input
                  key={fileKey}
                  id="calendar-source-file"
                  type="file"
                  required
                  accept=".ics,text/calendar"
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                />
                <p className="text-xs text-muted-foreground">
                  {t("ICS file help")}
                </p>
              </div>
            )}
            <div className="flex flex-wrap gap-3">
              <div className="min-w-48 flex-1 space-y-1.5">
                <Label htmlFor="calendar-source-zone">
                  {t("Source time zone")}
                </Label>
                <Input
                  id="calendar-source-zone"
                  required
                  maxLength={100}
                  value={zone}
                  onChange={(event) => setZone(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="calendar-source-color">{t("Color")}</Label>
                <ColorSelect
                  id="calendar-source-color"
                  value={color}
                  onChange={setColor}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("Source time zone help")}
            </p>
            <Button type="submit" disabled={busy || state.sources.length >= 20}>
              {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
              {t("Add calendar")}
            </Button>
          </form>
        ) : (
          <p role="status" className="text-sm text-muted-foreground">
            {t("Shared sources unavailable")}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
