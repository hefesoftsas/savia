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

const colorLabels = {
  blue: "Azul",
  emerald: "Verde",
  violet: "Violeta",
  amber: "Ámbar",
  rose: "Rosa",
  slate: "Gris",
};
function ColorSelect({
  value,
  onChange,
  id,
}: {
  value: CalendarSource["color"];
  onChange: (value: CalendarSource["color"]) => void;
  id: string;
}) {
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
          {colorLabels[color]}
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
  const [editing, setEditing] = useState(false),
    [name, setName] = useState(source.name),
    [color, setColor] = useState(source.color);
  return (
    <li className="space-y-3 py-4">
      <div className="flex flex-wrap items-start gap-3">
        <input
          type="checkbox"
          aria-label={`Mostrar ${source.name}`}
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
            {source.kind === "import" ? "Copia importada" : "Suscripción"}
            {source.hostname ? ` · ${source.hostname}` : ""}
          </p>
          {source.lastSyncedAt ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Actualizado: {new Date(source.lastSyncedAt).toLocaleString("es")}
            </p>
          ) : null}
        </div>
        <div className="flex gap-1">
          {source.kind === "subscription" ? (
            <Button
              variant="ghost"
              size="icon"
              disabled={busy}
              aria-label={`Actualizar ${source.name}`}
              onClick={() => void run(() => state.refreshSource(source.id))}
            >
              <RefreshCw className="size-4" />
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="icon"
            disabled={busy}
            aria-label={`Editar ${source.name}`}
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
            aria-label={`Eliminar ${source.name}`}
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
            <Label htmlFor={`name-${source.id}`}>Nombre</Label>
            <Input
              id={`name-${source.id}`}
              value={name}
              maxLength={100}
              required
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`color-${source.id}`}>Color</Label>
            <ColorSelect
              id={`color-${source.id}`}
              value={color}
              onChange={setColor}
            />
          </div>
          <Button size="sm" disabled={busy}>
            Guardar
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setEditing(false)}
          >
            Cancelar
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
    reader.onerror = () => reject(new Error("No pudimos leer el archivo."));
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
  const [kind, setKind] = useState<"subscription" | "import">("subscription");
  const [name, setName] = useState(""),
    [url, setUrl] = useState(""),
    [zone, setZone] = useState(timeZone),
    [color, setColor] = useState<CalendarSource["color"]>("blue"),
    [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [success, setSuccess] = useState<string | null>(null),
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
      setError(
        "No pudimos guardar el cambio. Revisa los datos y vuelve a intentarlo.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!calendarTimeZoneSchema.safeParse(zone).success) {
      setError(
        "Indica una zona horaria válida, como Europe/Madrid o America/Bogota.",
      );
      return;
    }
    if (kind === "import" && (!file || file.size > 1048576)) {
      setError("Selecciona un archivo .ics de hasta 1 MiB.");
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
      setSuccess("Calendario añadido.");
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
          <DialogTitle>Gestionar calendarios</DialogTitle>
          <DialogDescription>
            Añade enlaces de suscripción o importa una copia .ics para consultar
            tus eventos.
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {success ? (
          <p role="status" className="text-sm">
            {success}
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
                {provider === "outlook" ? "Outlook" : "Google Calendar"}
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
            Todavía no has añadido calendarios compartidos.
          </p>
        )}
        {state.available ? (
          <form onSubmit={submit} className="space-y-4 border-t pt-4">
            <h3 className="text-sm font-semibold">Añadir calendario</h3>
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
                    ? "Enlace de suscripción"
                    : "Archivo .ics"}
                </Button>
              ))}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="calendar-source-name">
                Nombre del calendario
              </Label>
              <Input
                id="calendar-source-name"
                required
                maxLength={100}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Equipo, vacaciones…"
              />
            </div>
            {kind === "subscription" ? (
              <div className="space-y-1.5">
                <Label htmlFor="calendar-source-url">
                  Enlace HTTPS o WebCal
                </Label>
                <Input
                  id="calendar-source-url"
                  required
                  maxLength={4096}
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="webcal://…"
                />
                <p className="text-xs text-muted-foreground">
                  Usa el enlace de suscripción que comparte tu calendario. Se
                  actualizará mientras Mi día esté abierto.
                </p>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="calendar-source-file">
                  Archivo de calendario
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
                  Hasta 1 MiB. La copia conserva los eventos del archivo y no
                  recibe cambios posteriores.
                </p>
              </div>
            )}
            <div className="flex flex-wrap gap-3">
              <div className="min-w-48 flex-1 space-y-1.5">
                <Label htmlFor="calendar-source-zone">
                  Zona horaria de origen
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
                <Label htmlFor="calendar-source-color">Color</Label>
                <ColorSelect
                  id="calendar-source-color"
                  value={color}
                  onChange={setColor}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              La zona de origen se aplica cuando el archivo no define una zona
              horaria.
            </p>
            <Button type="submit" disabled={busy || state.sources.length >= 20}>
              {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
              Añadir calendario
            </Button>
          </form>
        ) : (
          <p role="status" className="text-sm text-muted-foreground">
            Las fuentes compartidas no están disponibles en esta sesión.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
