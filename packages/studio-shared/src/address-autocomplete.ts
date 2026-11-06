import { z } from "zod";

export const addressAutocompleteProviders = [
  "photon",
  "nominatim",
  "geoapify",
] as const;

export type AddressAutocompleteProvider =
  (typeof addressAutocompleteProviders)[number];

export type AddressSuggestion = {
  label: string;
  value: string;
  lat?: number;
  lng?: number;
};

export type AddressAutocompleteSettings = {
  provider: AddressAutocompleteProvider;
  country?: string;
  language?: string;
};

export const addressAutocompleteConfigSchema = z.union([
  z.literal(true),
  z.object({
    provider: z.enum(addressAutocompleteProviders).optional(),
    country: z
      .string()
      .trim()
      .regex(/^[a-z]{2}$/i, "Usa un código de país ISO de 2 letras.")
      .optional(),
    language: z.string().trim().min(2).max(5).optional(),
  }),
]);

export function resolveAddressAutocomplete(
  config?: Record<string, unknown>,
): AddressAutocompleteSettings | null {
  const raw = config?.addressAutocomplete;
  if (!raw) return null;
  if (raw === true) return { provider: "photon", language: "es" };
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Record<string, unknown>;
  const provider = addressAutocompleteProviders.includes(
    value.provider as AddressAutocompleteProvider,
  )
    ? (value.provider as AddressAutocompleteProvider)
    : "photon";
  return {
    provider,
    country:
      typeof value.country === "string"
        ? value.country.trim().toLowerCase()
        : undefined,
    language:
      typeof value.language === "string" ? value.language.trim() : "es",
  };
}

type PhotonFeature = {
  geometry?: { coordinates?: [number, number] };
  properties?: Record<string, string | undefined>;
};

type NominatimResult = {
  display_name?: string;
  lat?: string;
  lon?: string;
};

type GeoapifyFeature = {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    formatted?: string;
    address_line1?: string;
    address_line2?: string;
    city?: string;
    state?: string;
    country?: string;
    lat?: number;
    lon?: number;
  };
};

function formatPhotonFeature(feature: PhotonFeature): AddressSuggestion | null {
  const properties = feature.properties ?? {};
  const street = [properties.housenumber, properties.street]
    .filter(Boolean)
    .join(" ")
    .trim();
  const parts = [
    street,
    properties.name &&
    properties.name !== properties.street &&
    properties.name !== street
      ? properties.name
      : undefined,
    properties.city || properties.locality,
    properties.state,
    properties.country,
  ].filter(Boolean);
  const label = parts.join(", ");
  const [lng, lat] = feature.geometry?.coordinates ?? [];
  return label
    ? {
        label,
        value: label,
        ...(typeof lat === "number" && typeof lng === "number"
          ? { lat, lng }
          : {}),
      }
    : null;
}

function formatNominatimResult(result: NominatimResult): AddressSuggestion | null {
  const label = result.display_name?.trim();
  const lat = result.lat ? Number(result.lat) : undefined;
  const lng = result.lon ? Number(result.lon) : undefined;
  return label
    ? {
        label,
        value: label,
        ...(Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : {}),
      }
    : null;
}

function formatGeoapifyFeature(
  feature: GeoapifyFeature,
): AddressSuggestion | null {
  const properties = feature.properties ?? {};
  const label =
    properties.formatted?.trim() ||
    [properties.address_line1, properties.address_line2]
      .filter(Boolean)
      .join(", ")
      .trim() ||
    [properties.city, properties.state, properties.country]
      .filter(Boolean)
      .join(", ")
      .trim();
  const geometryLng = feature.geometry?.coordinates?.[0];
  const geometryLat = feature.geometry?.coordinates?.[1];
  const lat =
    typeof properties.lat === "number"
      ? properties.lat
      : typeof geometryLat === "number"
        ? geometryLat
        : undefined;
  const lng =
    typeof properties.lon === "number"
      ? properties.lon
      : typeof geometryLng === "number"
        ? geometryLng
        : undefined;
  return label
    ? {
        label,
        value: label,
        ...(typeof lat === "number" && typeof lng === "number" ? { lat, lng } : {}),
      }
    : null;
}

function matchesCountry(
  country: string | undefined,
  countryCode: string | undefined,
) {
  if (!country || !countryCode) return true;
  return country.toLowerCase() === countryCode.toLowerCase();
}

function dedupeSuggestions(items: AddressSuggestion[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.value.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function searchAddressSuggestions(
  query: string,
  settings: AddressAutocompleteSettings,
  options?: {
    apiKey?: string;
    fetchImpl?: typeof fetch;
    limit?: number;
  },
): Promise<AddressSuggestion[]> {
  const trimmed = query.trim();
  if (trimmed.length < 3) return [];
  const limit = options?.limit ?? 5;
  const fetchImpl = options?.fetchImpl ?? fetch;

  if (settings.provider === "photon") {
    const url = new URL("https://photon.komoot.io/api/");
    url.searchParams.set("q", trimmed);
    url.searchParams.set("limit", String(limit));
    if (settings.language) url.searchParams.set("lang", settings.language);
    const response = await fetchImpl(url);
    if (!response.ok) throw new Error("No se pudo consultar Photon.");
    const payload = (await response.json()) as { features?: PhotonFeature[] };
    return dedupeSuggestions(
      (payload.features ?? [])
        .filter((feature) =>
          matchesCountry(
            settings.country,
            feature.properties?.countrycode,
          ),
        )
        .map(formatPhotonFeature)
        .filter((item): item is AddressSuggestion => !!item),
    );
  }

  if (settings.provider === "nominatim") {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", trimmed);
    url.searchParams.set("format", "json");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("limit", String(limit));
    if (settings.country)
      url.searchParams.set("countrycodes", settings.country);
    if (settings.language)
      url.searchParams.set("accept-language", settings.language);
    const response = await fetchImpl(url, {
      headers: {
        "User-Agent": "SaviaCRM/1.0 (address-autocomplete)",
        Accept: "application/json",
      },
    });
    if (!response.ok) throw new Error("No se pudo consultar Nominatim.");
    const payload = (await response.json()) as NominatimResult[];
    return dedupeSuggestions(
      payload
        .map(formatNominatimResult)
        .filter((item): item is AddressSuggestion => !!item),
    );
  }

  if (!options?.apiKey) throw new Error("Geoapify no está configurado.");
  const url = new URL("https://api.geoapify.com/v1/geocode/autocomplete");
  url.searchParams.set("text", trimmed);
  url.searchParams.set("apiKey", options.apiKey);
  url.searchParams.set("limit", String(limit));
  if (settings.language) url.searchParams.set("lang", settings.language);
  if (settings.country)
    url.searchParams.set("filter", `countrycode:${settings.country}`);
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error("No se pudo consultar Geoapify.");
  const payload = (await response.json()) as { features?: GeoapifyFeature[] };
  return dedupeSuggestions(
    (payload.features ?? [])
      .map(formatGeoapifyFeature)
      .filter((item): item is AddressSuggestion => !!item),
  );
}

type ReverseGeocodeResult = {
  label: string;
  address?: string;
};

export async function reverseGeocodeLocation(
  lat: number,
  lng: number,
  settings: AddressAutocompleteSettings,
  options?: {
    apiKey?: string;
    fetchImpl?: typeof fetch;
  },
): Promise<ReverseGeocodeResult> {
  const fetchImpl = options?.fetchImpl ?? fetch;

  if (settings.provider === "photon") {
    const url = new URL("https://photon.komoot.io/reverse");
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lon", String(lng));
    if (settings.language) url.searchParams.set("lang", settings.language);
    const response = await fetchImpl(url);
    if (!response.ok) throw new Error("No se pudo consultar Photon.");
    const payload = (await response.json()) as { features?: PhotonFeature[] };
    const suggestion = formatPhotonFeature(payload.features?.[0] ?? {});
    if (!suggestion) throw new Error("No se encontró una dirección para este punto.");
    return { label: suggestion.label, address: suggestion.value };
  }

  if (settings.provider === "nominatim") {
    const url = new URL("https://nominatim.openstreetmap.org/reverse");
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lon", String(lng));
    url.searchParams.set("format", "json");
    if (settings.language)
      url.searchParams.set("accept-language", settings.language);
    const response = await fetchImpl(url, {
      headers: {
        "User-Agent": "SaviaCRM/1.0 (map-location)",
        Accept: "application/json",
      },
    });
    if (!response.ok) throw new Error("No se pudo consultar Nominatim.");
    const payload = (await response.json()) as NominatimResult;
    const suggestion = formatNominatimResult(payload);
    if (!suggestion) throw new Error("No se encontró una dirección para este punto.");
    return { label: suggestion.label, address: suggestion.value };
  }

  if (!options?.apiKey) throw new Error("Geoapify no está configurado.");
  const url = new URL("https://api.geoapify.com/v1/geocode/reverse");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lng));
  url.searchParams.set("apiKey", options.apiKey);
  if (settings.language) url.searchParams.set("lang", settings.language);
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error("No se pudo consultar Geoapify.");
  const payload = (await response.json()) as { features?: GeoapifyFeature[] };
  const suggestion = formatGeoapifyFeature(payload.features?.[0] ?? {});
  if (!suggestion) throw new Error("No se encontró una dirección para este punto.");
  return { label: suggestion.label, address: suggestion.value };
}
