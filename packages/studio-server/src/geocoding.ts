import type { Hono } from "hono";
import { z } from "zod";
import {
  addressAutocompleteProviders,
  reverseGeocodeLocation,
  searchAddressSuggestions,
} from "@savia/studio-shared/address-autocomplete";
import { resolveApproximateLocation } from "@savia/studio-shared/map-location";
import { getGeoapifyApiKey } from "./geocoding-settings";
import type { Env } from "./context";

const searchSchema = z.object({
  q: z.string().trim().min(3).max(200),
  provider: z.enum(addressAutocompleteProviders).default("photon"),
  country: z
    .string()
    .trim()
    .regex(/^[a-z]{2}$/i)
    .optional(),
  language: z.string().trim().min(2).max(5).default("es"),
  limit: z.coerce.number().int().min(1).max(10).default(5),
});

const reverseSchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  provider: z.enum(addressAutocompleteProviders).default("photon"),
  country: z
    .string()
    .trim()
    .regex(/^[a-z]{2}$/i)
    .optional(),
  language: z.string().trim().min(2).max(5).default("es"),
});

export function registerGeocoding(app: Hono<Env>) {
  app.get("/api/geocoding/search", async (c) => {
    const parsed = searchSchema.parse(c.req.query());
    const apiKey =
      parsed.provider === "geoapify"
        ? await getGeoapifyApiKey(
            c.env.DB,
            c.get("tenant"),
            c.env.INTEGRATION_KEY,
            c.env.GEOAPIFY_API_KEY,
          )
        : undefined;
    if (parsed.provider === "geoapify" && !apiKey)
      return c.json(
        {
          error:
            "Geoapify no está configurado. Guarda la API key en Claves y servicios o define GEOAPIFY_API_KEY en el servidor.",
        },
        503,
      );
    const data = await searchAddressSuggestions(
      parsed.q,
      {
        provider: parsed.provider,
        country: parsed.country?.toLowerCase(),
        language: parsed.language,
      },
      { apiKey, limit: parsed.limit },
    );
    return c.json({ data });
  });

  app.get("/api/geocoding/reverse", async (c) => {
    const parsed = reverseSchema.parse(c.req.query());
    const apiKey =
      parsed.provider === "geoapify"
        ? await getGeoapifyApiKey(
            c.env.DB,
            c.get("tenant"),
            c.env.INTEGRATION_KEY,
            c.env.GEOAPIFY_API_KEY,
          )
        : undefined;
    if (parsed.provider === "geoapify" && !apiKey)
      return c.json(
        {
          error:
            "Geoapify no está configurado. Guarda la API key en Claves y servicios o define GEOAPIFY_API_KEY en el servidor.",
        },
        503,
      );
    const data = await reverseGeocodeLocation(
      parsed.lat,
      parsed.lng,
      {
        provider: parsed.provider,
        country: parsed.country?.toLowerCase(),
        language: parsed.language,
      },
      { apiKey },
    );
    return c.json({ data });
  });

  app.get("/api/geocoding/approximate", async (c) => {
    const cf = (c.req.raw as { cf?: { latitude?: number; longitude?: number } }).cf;
    const data = await resolveApproximateLocation({
      cfLatitude: cf?.latitude,
      cfLongitude: cf?.longitude,
    });
    return c.json({ data });
  });
}
