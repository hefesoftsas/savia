/// <reference path="./assets.d.ts" />
import brandEquidad from "./assets/brand-equidad.svg";
import brandLiberty from "./assets/brand-liberty.webp";
import brandMapfre from "./assets/brand-mapfre.png";
import brandPrevisora from "./assets/brand-previsora.png";
import brandQualitas from "./assets/brand-qualitas.svg";
import brandSbs from "./assets/brand-sbs.png";
import brandSura from "./assets/brand-sura.svg";

type InsurerBrand =
  | "equidad"
  | "liberty"
  | "mapfre"
  | "previsora"
  | "qualitas"
  | "sbs"
  | "sura"
  | "fallback";

const providerLogo: Record<Exclude<InsurerBrand, "fallback">, string> = {
  equidad: brandEquidad,
  liberty: brandLiberty,
  mapfre: brandMapfre,
  previsora: brandPrevisora,
  qualitas: brandQualitas,
  sbs: brandSbs,
  sura: brandSura,
};

function normalizeProvider(provider: string): string {
  return provider
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-CO");
}

function brandFor(provider: string): InsurerBrand {
  const normalized = normalizeProvider(provider);
  if (normalized.includes("sura")) return "sura";
  if (normalized.includes("liberty")) return "liberty";
  if (normalized.includes("equidad")) return "equidad";
  if (normalized.includes("mapfre")) return "mapfre";
  if (normalized.includes("qualitas")) return "qualitas";
  if (normalized.includes("previsora")) return "previsora";
  if (normalized.includes("sbs")) return "sbs";
  return "fallback";
}

function fallbackInitials(provider: string): string {
  return (
    provider
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0])
      .join("")
      .toUpperCase() || "S"
  );
}

export function ProviderLogo({
  provider,
  decorative = false,
  compact = false,
}: {
  provider: string;
  decorative?: boolean;
  compact?: boolean;
}) {
  const brand = brandFor(provider);
  const className = [
    "insurance-provider-logo",
    `insurance-provider-logo--${brand}`,
    compact ? "insurance-provider-logo--compact" : "",
  ]
    .filter(Boolean)
    .join(" ");

  if (brand === "fallback") {
    return (
      <span
        aria-hidden={decorative || undefined}
        aria-label={decorative ? undefined : `Identificador de ${provider}`}
        className={className}
        role={decorative ? undefined : "img"}
      >
        <span aria-hidden="true" className="insurance-provider-logo__fallback">
          {fallbackInitials(provider)}
        </span>
      </span>
    );
  }

  return (
    <span className={className}>
      <img
        alt={decorative ? "" : `Logo de ${provider}`}
        aria-hidden={decorative || undefined}
        className="insurance-provider-logo__image"
        decoding="async"
        src={providerLogo[brand]}
      />
    </span>
  );
}
