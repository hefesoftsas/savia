import { z } from "zod";
import { addressAutocompleteProviders } from "./address-autocomplete";

export type MapLocationValue = {
  lat: number;
  lng: number;
  label?: string;
  address?: string;
};

export const mapLocationValueSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  label: z.string().trim().max(200).optional(),
  address: z.string().trim().max(500).optional(),
});

export const mapPickerConfigSchema = z.object({
  reference: z
    .object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
      label: z.string().trim().min(1).max(120).optional(),
    })
    .optional(),
  geolocation: z.boolean().optional(),
  reverseGeocode: z.boolean().optional(),
  zoom: z.number().int().min(3).max(18).optional(),
  provider: z.enum(addressAutocompleteProviders).optional(),
  country: z
    .string()
    .trim()
    .regex(/^[a-z]{2}$/i, "Usa un código de país ISO de 2 letras.")
    .optional(),
  language: z.string().trim().min(2).max(5).optional(),
});

export type MapPickerSettings = z.infer<typeof mapPickerConfigSchema>;

export const defaultMapCenter = { lat: 4.6097, lng: -74.0817 };

export function resolveMapPicker(
  config?: Record<string, unknown>,
): MapPickerSettings {
  const raw = config?.mapPicker;
  if (!raw || typeof raw !== "object") {
    return { geolocation: true, reverseGeocode: true, zoom: 14, language: "es" };
  }
  const parsed = mapPickerConfigSchema.safeParse(raw);
  if (!parsed.success) {
    return { geolocation: true, reverseGeocode: true, zoom: 14, language: "es" };
  }
  return {
    geolocation: true,
    reverseGeocode: true,
    zoom: 14,
    language: "es",
    ...parsed.data,
  };
}

export function parseMapLocation(value: unknown): MapLocationValue | null {
  if (value == null || value === "") return null;
  const candidate =
    typeof value === "string"
      ? (() => {
          try {
            return JSON.parse(value);
          } catch {
            return null;
          }
        })()
      : value;
  const parsed = mapLocationValueSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

export function formatMapLocationSummary(value: unknown) {
  const location = parseMapLocation(value);
  if (!location) return "";
  return (
    location.label ||
    location.address ||
    `${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}`
  );
}

export function mapLocationCenter(settings: MapPickerSettings) {
  if (settings.reference) {
    return {
      lat: settings.reference.lat,
      lng: settings.reference.lng,
    };
  }
  return defaultMapCenter;
}

export type GeoFailureMessage = {
  title: string;
  description: string;
};

export function geolocationEnvironmentError(): GeoFailureMessage | null {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return {
      title: "Geolocalización no disponible",
      description: "Tu navegador no puede detectar la ubicación.",
    };
  }
  if (typeof window !== "undefined" && !window.isSecureContext) {
    return {
      title: "Conexión no segura",
      description:
        "La ubicación solo funciona en HTTPS o localhost. Abre Savia con una URL segura.",
    };
  }
  return null;
}

export function describeGeoFailure(error: { code?: number }): GeoFailureMessage {
  switch (error.code) {
    case 1:
      return {
        title: "Permiso de ubicación bloqueado",
        description:
          "Activa la ubicación para este sitio en tu navegador o dispositivo.",
      };
    case 2:
      return {
        title: "Señal de ubicación no disponible",
        description:
          "Prueba en otro lugar, busca una dirección o marca el punto en el mapa.",
      };
    case 3:
      return {
        title: "La detección tardó demasiado",
        description:
          "Usamos tu ubicación aproximada por red cuando el GPS no responde.",
      };
    default:
      return {
        title: "No se pudo usar tu ubicación",
        description: "Marca el punto en el mapa o busca una dirección.",
      };
  }
}

function getCurrentPosition(options: PositionOptions) {
  return new Promise<GeolocationCoordinates>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) => resolve(position.coords),
      reject,
      options,
    );
  });
}

function watchPositionOnce(options: PositionOptions, timeoutMs: number) {
  return new Promise<GeolocationCoordinates>((resolve, reject) => {
    let watchId: number | undefined;
    const timer = window.setTimeout(() => {
      if (watchId !== undefined) navigator.geolocation.clearWatch(watchId);
      reject(Object.assign(new Error("Geolocation timeout"), { code: 3 }));
    }, timeoutMs);

    watchId = navigator.geolocation.watchPosition(
      (position) => {
        window.clearTimeout(timer);
        if (watchId !== undefined) navigator.geolocation.clearWatch(watchId);
        resolve(position.coords);
      },
      (error) => {
        window.clearTimeout(timer);
        if (watchId !== undefined) navigator.geolocation.clearWatch(watchId);
        reject(error);
      },
      options,
    );
  });
}

export type ApproximateLocation = {
  lat: number;
  lng: number;
  label?: string;
  source: "cloudflare" | "network" | "default";
};

async function fetchApproximateFromNetwork(
  fetchImpl: typeof fetch = fetch,
): Promise<ApproximateLocation | null> {
  try {
    const response = await fetchImpl(
      "https://ip-api.com/json/?fields=status,lat,lon,city,regionName,country",
      { signal: AbortSignal.timeout(8000) },
    );
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      status?: string;
      lat?: number;
      lon?: number;
      city?: string;
      regionName?: string;
      country?: string;
    };
    if (payload.status !== "success") return null;
    if (
      typeof payload.lat !== "number" ||
      typeof payload.lon !== "number" ||
      !Number.isFinite(payload.lat) ||
      !Number.isFinite(payload.lon)
    ) {
      return null;
    }
    const label = [payload.city, payload.regionName, payload.country]
      .filter(Boolean)
      .join(", ");
    return {
      lat: payload.lat,
      lng: payload.lon,
      label: label || undefined,
      source: "network",
    };
  } catch {
    return null;
  }
}

export async function resolveApproximateLocation(options?: {
  cfLatitude?: number;
  cfLongitude?: number;
  fetchImpl?: typeof fetch;
}): Promise<ApproximateLocation> {
  const cfLat = options?.cfLatitude;
  const cfLng = options?.cfLongitude;
  if (
    typeof cfLat === "number" &&
    typeof cfLng === "number" &&
    Number.isFinite(cfLat) &&
    Number.isFinite(cfLng)
  ) {
    return { lat: cfLat, lng: cfLng, source: "cloudflare" };
  }

  const network = await fetchApproximateFromNetwork(options?.fetchImpl);
  if (network) return network;

  return {
    lat: defaultMapCenter.lat,
    lng: defaultMapCenter.lng,
    label: "Bogotá, Colombia",
    source: "default",
  };
}

export async function requestCurrentLocation(options?: {
  approximate?: () => Promise<ApproximateLocation>;
}) {
  const environmentError = geolocationEnvironmentError();
  if (environmentError) {
    throw Object.assign(new Error(environmentError.title), { code: 2 });
  }

  if (navigator.permissions?.query) {
    try {
      const status = await navigator.permissions.query({ name: "geolocation" });
      if (status.state === "denied") {
        throw Object.assign(new Error("Permission denied"), { code: 1 });
      }
    } catch {
      /* Permissions API is optional. */
    }
  }

  const attempts: Array<() => Promise<GeolocationCoordinates>> = [
    () =>
      getCurrentPosition({
        enableHighAccuracy: false,
        timeout: 5000,
        maximumAge: 300000,
      }),
    () =>
      getCurrentPosition({
        enableHighAccuracy: false,
        timeout: 8000,
        maximumAge: 0,
      }),
    () =>
      watchPositionOnce({ enableHighAccuracy: false, maximumAge: 0 }, 10000),
  ];

  let lastError: GeolocationPositionError | Error | null = null;
  for (const attempt of attempts) {
    try {
      return { coords: await attempt(), approximate: false as const };
    } catch (error) {
      lastError = error as GeolocationPositionError | Error;
      if (
        error instanceof Object &&
        "code" in error &&
        (error as GeolocationPositionError).code === 1
      ) {
        throw error;
      }
    }
  }

  if (options?.approximate) {
    const approx = await options.approximate();
    return {
      coords: {
        latitude: approx.lat,
        longitude: approx.lng,
        accuracy: 5000,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
      } as GeolocationCoordinates,
      approximate: true as const,
      label: approx.label,
      source: approx.source,
    };
  }

  throw lastError ?? Object.assign(new Error("Geolocation failed"), { code: 2 });
}
