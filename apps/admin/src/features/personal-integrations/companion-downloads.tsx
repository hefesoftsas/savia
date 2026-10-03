import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import Android from "@thesvg/react/android";
import Windows from "@thesvg/react/windows";
import Apple from "@thesvg/react/apple";
import { Button } from "@/components/ui/button";
import { intlLocale, useAppLocale, useMessages } from "@/i18n/core";
import { companionDownloadMessages } from "./companion-downloads-messages";
import { IntegrationGroup } from "./integration-ui";

const repository = "https://github.com/hefesoftsas/savia";
const files = {
  android: "savia-companion-android.apk",
  windows: "savia-companion-windows-x64.exe",
  macos: "savia-companion-macos-arm64.dmg",
} as const;
type Platform = keyof typeof files;
type DownloadAsset = { url: string; bytes: number };
type CompanionRelease = {
  tag: string;
  assets: Record<Platform, DownloadAsset>;
};
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** Only expose complete, published preview bundles from this repository. */
export function selectCompanionRelease(data: unknown): CompanionRelease | null {
  if (!Array.isArray(data)) throw new Error("Invalid release catalog");
  const releases = data
    .filter(isObject)
    .filter(
      (release) =>
        release.draft === false &&
        release.prerelease === true &&
        typeof release.tag_name === "string" &&
        /^companion-preview-[a-zA-Z0-9.-]+$/.test(release.tag_name) &&
        typeof release.published_at === "string" &&
        Number.isFinite(Date.parse(release.published_at)),
    )
    .sort(
      (a, b) =>
        Date.parse(b.published_at as string) -
        Date.parse(a.published_at as string),
    );
  for (const release of releases) {
    if (!Array.isArray(release.assets)) continue;
    const assets = {} as Record<Platform, DownloadAsset>;
    for (const platform of Object.keys(files) as Platform[]) {
      const file = files[platform];
      const expectedUrl = `${repository}/releases/download/${release.tag_name}/${file}`;
      const asset = release.assets.find(
        (asset: unknown) =>
          isObject(asset) &&
          asset.name === file &&
          asset.state === "uploaded" &&
          asset.browser_download_url === expectedUrl &&
          typeof asset.size === "number" &&
          asset.size > 0 &&
          Number.isFinite(asset.size),
      );
      if (asset) assets[platform] = { url: expectedUrl, bytes: asset.size };
    }
    if (Object.keys(assets).length === Object.keys(files).length)
      return { tag: release.tag_name as string, assets };
  }
  return null;
}

type DownloadState =
  | { status: "loading" | "failed" }
  | { status: "ready"; release: CompanionRelease | null };
export function CompanionDownloads() {
  const t = useMessages(companionDownloadMessages);
  const locale = useAppLocale();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<DownloadState>({ status: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setState({ status: "loading" });
    const timeout = setTimeout(() => controller.abort(), 15000);
    void fetch("/companion-downloads.json", {
      signal: controller.signal,
      credentials: "omit",
      headers: { Accept: "application/json" },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Release discovery failed");
        const release = selectCompanionRelease(await response.json());
        if (active) setState({ status: "ready", release });
      })
      .catch(() => {
        if (active) setState({ status: "failed" });
      })
      .finally(() => clearTimeout(timeout));
    return () => {
      active = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [attempt]);
  const release = state.status === "ready" ? state.release : null;
  const platforms = [
    {
      id: "android" as const,
      name: "Android",
      requirements: t("Android 7 o posterior · APK"),
      action: t("Descargar Android"),
      Icon: Android,
    },
    {
      id: "windows" as const,
      name: "Windows",
      requirements: t("Windows 11 · 64 bits"),
      action: t("Descargar Windows"),
      Icon: Windows,
    },
    {
      id: "macos" as const,
      name: "macOS",
      requirements: t("macOS 14.2 o posterior · Apple Silicon"),
      action: t("Descargar macOS"),
      Icon: Apple,
    },
  ];
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">Savia Companion</h2>
        <p className="max-w-prose text-sm leading-6 text-muted-foreground">
          {t(
            "Graba audio desde tu teléfono o computador y envíalo a Savia para generar resúmenes y hacer preguntas.",
          )}
        </p>
        <p className="text-sm leading-6 text-muted-foreground">
          {t(
            "Versiones de preview para pruebas. Android usa firma de prueba; los instaladores de escritorio todavía no tienen firma de distribución ni notarización.",
          )}
        </p>
      </div>
      {state.status === "loading" && (
        <p role="status" className="text-sm text-muted-foreground">
          {t("Buscando descargas disponibles…")}
        </p>
      )}
      {state.status === "failed" && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-xl border p-4"
        >
          <p className="flex-1 text-sm">
            {t(
              "No pudimos consultar las descargas. Revisa tu conexión e inténtalo de nuevo.",
            )}
          </p>
          <Button variant="outline" onClick={() => setAttempt(attempt + 1)}>
            {t("Reintentar")}
          </Button>
        </div>
      )}
      {state.status === "ready" && !release && (
        <p
          role="status"
          className="rounded-xl border bg-muted/30 p-4 text-sm leading-6"
        >
          {t(
            "Todavía no hay una versión de Companion publicada para descargar.",
          )}
        </p>
      )}
      <IntegrationGroup
        title={t("Elige tu dispositivo")}
        headingId="companion-download-devices"
      >
        {platforms.map(({ id, name, requirements, action, Icon }) => (
          <li key={id} className="integrations-row integrations-row--static">
            <div className="flex min-w-0 items-center gap-3">
              <Icon
                className="size-6 shrink-0 text-foreground"
                aria-hidden="true"
              />
              <div className="min-w-0">
                <h3 className="text-sm font-medium">{name}</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {requirements}
                </p>
              </div>
            </div>
            <div className="integrations-row__actions">
              {release ? (
                <Button asChild variant="outline">
                  <a href={release.assets[id].url} rel="noreferrer">
                    <Download aria-hidden="true" className="size-4" />
                    {action}
                    <span className="text-xs text-muted-foreground">
                      {new Intl.NumberFormat(intlLocale(locale), {
                        minimumFractionDigits: 1,
                        maximumFractionDigits: 1,
                      }).format(release.assets[id].bytes / 1000000)}{" "}
                      MB
                    </span>
                  </a>
                </Button>
              ) : (
                <Button variant="outline" disabled>
                  {action}
                </Button>
              )}
            </div>
          </li>
        ))}
      </IntegrationGroup>
      {release && (
        <p className="text-xs text-muted-foreground">
          {t("Versión")}: {release.tag}
        </p>
      )}
      <p className="text-sm leading-6 text-muted-foreground">
        {t(
          "Después de instalar, conecta Companion con tu cuenta de Savia. El envío de grabaciones y su procesamiento requieren tu consentimiento.",
        )}
      </p>
    </div>
  );
}
