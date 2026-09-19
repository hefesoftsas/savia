import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import L from "leaflet";
import {
  AlertCircle,
  CheckCircle2,
  LoaderCircle,
  LocateFixed,
  Search,
} from "lucide-react";
import type { IFieldProps } from "@form-eng/core";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { api } from "./api";
import {
  describeGeoFailure,
  geolocationEnvironmentError,
  mapLocationCenter,
  parseMapLocation,
  requestCurrentLocation,
  resolveMapPicker,
  type MapLocationValue,
} from "@savia/crm-shared/map-location";
import "leaflet/dist/leaflet.css";
import "./map-location-field.css";

function roundCoord(value: number) {
  return Math.round(value * 1e6) / 1e6;
}

type GeoStatus = "idle" | "locating" | "success" | "error";

type GeoMessage = {
  title: string;
  description: string;
};

export function MapLocationField(p: IFieldProps) {
  const settings = resolveMapPicker(p.config);
  const location = parseMapLocation(p.value);
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const referenceMarkerRef = useRef<L.Marker | null>(null);
  const successTimerRef = useRef<number | null>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [geoStatus, setGeoStatus] = useState<GeoStatus>("idle");
  const [geoMessage, setGeoMessage] = useState<GeoMessage | null>(null);
  const listId = useId();

  const center = mapLocationCenter(settings);
  const readOnly = !!p.readOnly;

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(
    () => () => {
      if (successTimerRef.current) window.clearTimeout(successTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!searchRef.current?.contains(event.target as Node)) setSearchOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  const applyLocation = useCallback(
    (next: MapLocationValue) => {
      p.setFieldValue?.(p.fieldName!, {
        lat: roundCoord(next.lat),
        lng: roundCoord(next.lng),
        ...(next.label ? { label: next.label } : {}),
        ...(next.address ? { address: next.address } : {}),
      });
    },
    [p.fieldName, p.setFieldValue],
  );

  const reverseGeocode = useCallback(
    async (lat: number, lng: number) => {
      if (!settings.reverseGeocode) return undefined;
      const params = new URLSearchParams({
        lat: String(lat),
        lng: String(lng),
        provider: settings.provider ?? "photon",
        language: settings.language ?? "es",
      });
      if (settings.country) params.set("country", settings.country);
      const response = await api<{ data: { label: string; address?: string } }>(
        `/geocoding/reverse?${params}`,
      );
      return response.data;
    },
    [settings],
  );

  const setMapLocation = useCallback(
    async (lat: number, lng: number, keepLabel = false) => {
      const base: MapLocationValue = {
        lat,
        lng,
        ...(keepLabel && location?.label ? { label: location.label } : {}),
        ...(keepLabel && location?.address ? { address: location.address } : {}),
      };
      applyLocation(base);
      if (!settings.reverseGeocode) return;
      try {
        const resolved = await reverseGeocode(lat, lng);
        if (!resolved) return;
        applyLocation({
          lat,
          lng,
          label: resolved.label,
          address: resolved.address ?? resolved.label,
        });
      } catch {
        /* Keep coordinates even if reverse geocoding fails. */
      }
    },
    [applyLocation, location, reverseGeocode, settings.reverseGeocode],
  );

  const setMapLocationRef = useRef(setMapLocation);
  setMapLocationRef.current = setMapLocation;

  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return;
    const map = L.map(mapRef.current, {
      zoomControl: !readOnly,
      attributionControl: true,
    });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);
    mapInstance.current = map;

    if (settings.reference) {
      referenceMarkerRef.current = L.marker(
        [settings.reference.lat, settings.reference.lng],
        {
          draggable: false,
          icon: L.divIcon({
            className: "",
            html: '<span class="map-location-reference-icon"></span>',
            iconSize: [14, 14],
            iconAnchor: [7, 7],
          }),
        },
      )
        .addTo(map)
        .bindPopup(settings.reference.label ?? "Punto de referencia");
    }

    markerRef.current = L.marker([center.lat, center.lng], {
      draggable: !readOnly,
      icon: L.divIcon({
        className: "",
        html: '<span class="map-location-picker-icon"></span>',
        iconSize: [18, 18],
        iconAnchor: [9, 18],
      }),
    }).addTo(map);

    map.setView([center.lat, center.lng], settings.zoom ?? 14);

    if (!readOnly) {
      map.on("click", (event) => {
        setGeoStatus("idle");
        setGeoMessage(null);
        void setMapLocationRef.current(event.latlng.lat, event.latlng.lng);
      });
      markerRef.current.on("dragend", () => {
        setGeoStatus("idle");
        setGeoMessage(null);
        const point = markerRef.current?.getLatLng();
        if (!point) return;
        void setMapLocationRef.current(point.lat, point.lng);
      });
    }

    return () => {
      map.remove();
      mapInstance.current = null;
      markerRef.current = null;
      referenceMarkerRef.current = null;
    };
  }, [center.lat, center.lng, readOnly, settings.reference, settings.zoom]);

  useEffect(() => {
    const map = mapInstance.current;
    const marker = markerRef.current;
    if (!map || !marker) return;
    if (!location) {
      marker.setLatLng([center.lat, center.lng]);
      return;
    }
    marker.setLatLng([location.lat, location.lng]);
    if (settings.reference) {
      const bounds = L.latLngBounds([
        [location.lat, location.lng],
        [settings.reference.lat, settings.reference.lng],
      ]);
      map.fitBounds(bounds.pad(0.25));
      return;
    }
    map.setView(
      [location.lat, location.lng],
      Math.max(map.getZoom(), settings.zoom ?? 14),
    );
  }, [
    center.lat,
    center.lng,
    location?.lat,
    location?.lng,
    settings.reference,
    settings.zoom,
  ]);

  const suggestions = useQuery({
    queryKey: [
      "geocoding",
      "map-search",
      debouncedSearch,
      settings.provider,
      settings.country,
      settings.language,
    ],
    queryFn: () => {
      const params = new URLSearchParams({
        q: debouncedSearch.trim(),
        provider: settings.provider ?? "photon",
        language: settings.language ?? "es",
      });
      if (settings.country) params.set("country", settings.country);
      return api<{ data: { label: string; value: string; lat?: number; lng?: number }[] }>(
        `/geocoding/search?${params}`,
      ).then((response) => response.data);
    },
    enabled:
      !readOnly && searchOpen && debouncedSearch.trim().length >= 3,
    staleTime: 60_000,
  });

  const searchResults = suggestions.data ?? [];
  const showSearchResults = searchOpen && searchResults.length > 0;

  async function useCurrentLocation() {
    if (!settings.geolocation || readOnly) return;
    const environmentError = geolocationEnvironmentError();
    if (environmentError) {
      setGeoStatus("error");
      setGeoMessage(environmentError);
      return;
    }
    setGeoStatus("locating");
    setGeoMessage(null);

    const approxPromise = api<{
      data: { lat: number; lng: number; label?: string; source: string };
    }>("/geocoding/approximate")
      .then((response) => response.data)
      .catch(() => null);

    const showSuccess = (approximate: boolean, label?: string) => {
      setGeoStatus("success");
      setGeoMessage(
        approximate
          ? {
              title: "Ubicación aproximada detectada",
              description:
                label ??
                "Centramos el mapa según tu red. Ajusta el marcador si hace falta.",
            }
          : {
              title: "Ubicación detectada",
              description: "Ajusta el marcador si necesitas corregir la dirección.",
            },
      );
      if (successTimerRef.current) window.clearTimeout(successTimerRef.current);
      successTimerRef.current = window.setTimeout(() => {
        setGeoStatus("idle");
        setGeoMessage(null);
      }, 2600);
    };

    try {
      const browser = await Promise.race([
        requestCurrentLocation(),
        new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 8000)),
      ]);

      if (browser) {
        await setMapLocation(browser.coords.latitude, browser.coords.longitude);
        showSuccess(false);
        return;
      }

      const approx = await approxPromise;
      if (approx) {
        await setMapLocation(approx.lat, approx.lng);
        showSuccess(true, approx.label);
        return;
      }

      const retry = await requestCurrentLocation({
        approximate: async () => {
          throw Object.assign(new Error("Approximate unavailable"), { code: 2 });
        },
      });
      await setMapLocation(retry.coords.latitude, retry.coords.longitude);
      showSuccess(retry.approximate, retry.label);
    } catch (error) {
      if (
        error instanceof Object &&
        "code" in error &&
        (error as GeolocationPositionError).code === 1
      ) {
        setGeoStatus("error");
        setGeoMessage(describeGeoFailure(error as GeolocationPositionError));
        return;
      }
      const approx = await approxPromise;
      if (approx) {
        await setMapLocation(approx.lat, approx.lng);
        showSuccess(true, approx.label);
        return;
      }
      setGeoStatus("error");
      if (
        error instanceof Object &&
        "code" in error &&
        typeof (error as GeolocationPositionError).code === "number"
      ) {
        setGeoMessage(describeGeoFailure(error as GeolocationPositionError));
        return;
      }
      setGeoMessage({
        title: "Geolocalización no disponible",
        description: "Marca el punto en el mapa o busca una dirección.",
      });
    }
  }

  async function chooseSuggestion(option: {
    label: string;
    value: string;
    lat?: number;
    lng?: number;
  }) {
    setSearch(option.label);
    setSearchOpen(false);
    setGeoStatus("idle");
    setGeoMessage(null);
    if (typeof option.lat === "number" && typeof option.lng === "number") {
      void setMapLocation(option.lat, option.lng);
      return;
    }
    applyLocation({
      lat: location?.lat ?? center.lat,
      lng: location?.lng ?? center.lng,
      label: option.label,
      address: option.value,
    });
  }

  const bannerCopy =
    geoMessage ??
    (geoStatus === "locating"
      ? {
          title: "Detectando tu ubicación",
          description: "Esto puede tardar unos segundos.",
        }
      : null);
  const showGeoBanner =
    settings.geolocation && !readOnly && geoStatus !== "idle" && bannerCopy;

  return (
    <div
      className="map-location-field"
      aria-labelledby={`${p.config?.inputId ?? p.fieldName}_label`}
      aria-invalid={!!p.error}
      aria-required={p.required}
    >
      {!readOnly ? (
        <div ref={searchRef} className="map-location-search">
          <div className="map-location-search-field">
            <Search className="map-location-search-icon" size={16} aria-hidden="true" />
            <Input
              className="map-location-search-input"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={showSearchResults}
              aria-controls={showSearchResults ? listId : undefined}
              placeholder="Buscar dirección…"
              value={search}
              onFocus={() => setSearchOpen(true)}
              onChange={(event) => {
                setSearch(event.target.value);
                setSearchOpen(true);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") setSearchOpen(false);
              }}
            />
          </div>
          {suggestions.isFetching ? (
            <p className="map-location-search-hint">Buscando direcciones…</p>
          ) : searchOpen && search.trim().length > 0 && search.trim().length < 3 ? (
            <p className="map-location-search-hint">
              Escribe al menos 3 caracteres para buscar direcciones.
            </p>
          ) : suggestions.isError ? (
            <p className="map-location-search-hint" role="alert">
              No se pudieron cargar sugerencias de dirección.
            </p>
          ) : null}
          {showSearchResults ? (
            <ul id={listId} role="listbox" className="map-location-search-list">
              {searchResults.map((option) => (
                <li key={`${option.label}-${option.lat ?? option.value}`} role="presentation">
                  <button
                    type="button"
                    role="option"
                    className="map-location-search-option"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => void chooseSuggestion(option)}
                  >
                    {option.label}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className="map-location-frame">
        {showGeoBanner ? (
          <div
            className={cn(
              "map-location-status",
              geoStatus === "error" && "map-location-status--error",
              geoStatus === "success" && "map-location-status--success",
            )}
            role={geoStatus === "error" ? "alert" : "status"}
            aria-live="polite"
          >
            {geoStatus === "locating" ? (
              <LoaderCircle
                className="map-location-status-icon animate-spin"
                size={16}
                aria-hidden="true"
              />
            ) : geoStatus === "success" ? (
              <CheckCircle2
                className="map-location-status-icon"
                size={16}
                aria-hidden="true"
              />
            ) : (
              <AlertCircle
                className="map-location-status-icon"
                size={16}
                aria-hidden="true"
              />
            )}
            <div className="map-location-status-copy">
              <p className="map-location-status-title">{bannerCopy.title}</p>
              <p className="map-location-status-text">{bannerCopy.description}</p>
            </div>
            {geoStatus === "error" ? (
              <button
                type="button"
                className="map-location-status-action"
                onClick={() => void useCurrentLocation()}
              >
                Reintentar
              </button>
            ) : null}
          </div>
        ) : null}

        <div
          ref={mapRef}
          className={cn("map-location-map", readOnly && "map-location-map--readonly")}
          role="presentation"
        />

        {settings.geolocation && !readOnly ? (
          <TooltipProvider delayDuration={250}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "map-location-locate",
                    geoStatus === "locating" && "map-location-locate--active",
                  )}
                  aria-label={
                    geoStatus === "locating"
                      ? "Detectando tu ubicación"
                      : "Centrar en mi ubicación"
                  }
                  aria-busy={geoStatus === "locating"}
                  disabled={geoStatus === "locating"}
                  onClick={() => void useCurrentLocation()}
                >
                  {geoStatus === "locating" ? (
                    <>
                      <span className="map-location-locate-ring" aria-hidden="true" />
                      <LoaderCircle className="animate-spin" size={18} />
                    </>
                  ) : (
                    <LocateFixed size={18} aria-hidden="true" />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="left">
                {geoStatus === "locating"
                  ? "Detectando ubicación…"
                  : "Usar mi ubicación actual"}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : null}
      </div>

      {settings.reference ? (
        <p className="map-location-summary">
          Referencia: {settings.reference.label ?? "Punto configurado"} (
          {settings.reference.lat.toFixed(5)}, {settings.reference.lng.toFixed(5)})
        </p>
      ) : null}
    </div>
  );
}
