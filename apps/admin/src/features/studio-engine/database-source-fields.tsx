import { useMessages } from "@/i18n/core";
import { studioMessages } from "@/i18n/locales/studio";
import type { RefObject } from "react";
import {
  databaseKinds,
  type DatabaseKind,
} from "@savia/studio-shared/database-sources";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
export type DatabaseSourceDraft = {
  host: string;
  port: string;
  database: string;
  username: string;
  schema: string;
  ssl: boolean;
  authSource: string;
  trustServerCertificate: boolean;
  writeEnabled: boolean;
};
export function DatabaseSourceFields({
  kind,
  draft,
  onChange,
  editing,
  passwordRef,
  removePassword,
  onRemovePassword,
}: {
  kind: DatabaseKind;
  draft: DatabaseSourceDraft;
  onChange: (patch: Partial<DatabaseSourceDraft>) => void;
  editing: boolean;
  passwordRef: RefObject<HTMLInputElement | null>;
  removePassword: boolean;
  onRemovePassword: (value: boolean) => void;
}) {
  const t = useMessages(studioMessages);
  return (
    <div className="space-y-4">
      {!editing && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            {(
              [
                ["host", t("Host %{v1}", { v1: databaseKinds[kind].label })],
                ["port", t("Puerto")],
                ["database", t("Base de datos")],
                ["username", t("Usuario")],
              ] as const
            ).map(([key, label]) => (
              <div key={key} className="grid gap-1.5 text-sm">
                <Label htmlFor={`pg-${key}-input`}>{label}</Label>
                <Input
                  id={`pg-${key}-input`}
                  required={key !== "username" || kind !== "mongodb"}
                  value={draft[key]}
                  onChange={(e) => onChange({ [key]: e.target.value })}
                  {...(key === "port"
                    ? { inputMode: "numeric", pattern: "[0-9]*" }
                    : {})}
                />
              </div>
            ))}
          </div>
          {(kind === "postgres" || kind === "mssql") && (
            <div className="grid gap-1.5 text-sm">
              <Label htmlFor="pg-schema-input">{t("Esquema (opcional)")}</Label>
              <Input
                id="pg-schema-input"
                value={draft.schema}
                onChange={(e) => onChange({ schema: e.target.value })}
              />
            </div>
          )}
          {kind === "mongodb" && (
            <div className="grid gap-1.5 text-sm">
              <Label htmlFor="database-auth-source">
                {t("Base de autenticación")}
              </Label>
              <Input
                id="database-auth-source"
                value={draft.authSource}
                onChange={(e) => onChange({ authSource: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                {t("Conexión directa al servidor indicado.")}
              </p>
            </div>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.ssl}
              onChange={(e) => onChange({ ssl: e.target.checked })}
            />
            {kind === "mssql" ? t("Cifrar conexión") : t("Exigir SSL")}
          </label>
          {kind === "mssql" && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.trustServerCertificate}
                onChange={(e) =>
                  onChange({ trustServerCertificate: e.target.checked })
                }
              />
              {t("Confiar en certificado del servidor")}
            </label>
          )}
        </>
      )}
      <div className="grid gap-1.5 text-sm">
        <Label htmlFor="source-password-input">
          {t("Contraseña (opcional)")}
        </Label>
        <Input
          id="source-password-input"
          ref={passwordRef}
          type="password"
          autoComplete="new-password"
        />
        <p className="text-xs text-muted-foreground">
          {t("Se guarda cifrada en el servidor y nunca se devuelve.")}
        </p>
      </div>
      {editing && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={removePassword}
            onChange={(e) => onRemovePassword(e.target.checked)}
          />
          {t("Quitar contraseña")}
        </label>
      )}
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={draft.writeEnabled}
          onChange={(e) => onChange({ writeEnabled: e.target.checked })}
        />
        {t("Permitir crear, editar y eliminar registros")}
      </label>
      <p className="text-xs text-muted-foreground">
        {t(
          "Las operaciones disponibles también dependen de los permisos de la cuenta y de un identificador único. Las vistas son de solo lectura.",
        )}
      </p>
    </div>
  );
}
