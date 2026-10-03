import {
  boundedText,
  publicUrl,
  validatePublicDns,
} from "@savia/studio-server/integrations";
import { calendarLimits } from "@savia/studio-shared/calendar-contracts";
import type { StoredCalendarValidators } from "./repository";

export class CalendarTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalendarTransportError";
  }
}

export function normalizeCalendarUrl(raw: string): URL {
  const normalized = raw.trim().replace(/^webcal:/i, "https:");
  try {
    const url = publicUrl(normalized);
    if (url.protocol !== "https:" || (url.port && url.port !== "443"))
      throw new Error();
    return url;
  } catch {
    throw new CalendarTransportError(
      "Calendar subscriptions require a public HTTPS or WebCal address.",
    );
  }
}

export async function fetchCalendar(input: {
  url: string;
  validators?: StoredCalendarValidators | null;
  fetcher?: typeof fetch;
}): Promise<{
  status: 200 | 304;
  content?: string;
  validators: StoredCalendarValidators;
}> {
  const fetcher = input.fetcher ?? fetch;
  let target = normalizeCalendarUrl(input.url);
  const deadline = AbortSignal.timeout(calendarLimits.fetchTimeoutMs);
  const started = Date.now();
  const boundedFetcher: typeof fetch = (request, init = {}) =>
    fetcher(request, {
      ...init,
      signal: init.signal ? AbortSignal.any([init.signal, deadline]) : deadline,
    });
  for (
    let redirects = 0;
    redirects <= calendarLimits.maxRedirects;
    redirects++
  ) {
    if (Date.now() - started >= calendarLimits.fetchTimeoutMs)
      throw new CalendarTransportError("The calendar feed request timed out.");
    try {
      await validatePublicDns(target, boundedFetcher);
    } catch {
      throw new CalendarTransportError(
        "The calendar feed destination could not be verified as public.",
      );
    }
    let response: Response;
    try {
      const headers = new Headers({
        Accept: "text/calendar, text/plain;q=0.9, */*;q=0.1",
      });
      if (redirects === 0 && input.validators?.etag)
        headers.set("If-None-Match", input.validators.etag);
      if (redirects === 0 && input.validators?.lastModified)
        headers.set("If-Modified-Since", input.validators.lastModified);
      response = await boundedFetcher(target, {
        method: "GET",
        headers,
        redirect: "manual",
        credentials: "omit",
        signal: deadline,
      });
    } catch {
      throw new CalendarTransportError(
        "The calendar feed could not be reached.",
      );
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (redirects >= calendarLimits.maxRedirects)
        throw new CalendarTransportError(
          "The calendar feed redirected too many times.",
        );
      const location = response.headers.get("location");
      if (!location)
        throw new CalendarTransportError(
          "The calendar feed returned an invalid redirect.",
        );
      try {
        target = normalizeCalendarUrl(new URL(location, target).href);
      } catch {
        throw new CalendarTransportError(
          "The calendar feed redirected to an unsafe destination.",
        );
      }
      continue;
    }
    const sameValidatorHost = redirects === 0;
    const validators = {
      ...(redirects === 0 && response.headers.get("etag")
        ? { etag: response.headers.get("etag")! }
        : sameValidatorHost && input.validators?.etag
          ? { etag: input.validators.etag }
          : {}),
      ...(redirects === 0 && response.headers.get("last-modified")
        ? { lastModified: response.headers.get("last-modified")! }
        : sameValidatorHost && input.validators?.lastModified
          ? { lastModified: input.validators.lastModified }
          : {}),
    };
    if (response.status === 304) return { status: 304, validators };
    if (!response.ok)
      throw new CalendarTransportError(
        `The calendar feed returned HTTP ${response.status}.`,
      );
    try {
      const content = await boundedText(response, calendarLimits.maxBytes);
      if (
        new TextEncoder().encode(content).byteLength > calendarLimits.maxBytes
      )
        throw new Error();
      return { status: 200, content, validators };
    } catch {
      throw new CalendarTransportError(
        "The calendar feed response is invalid or exceeds the 1 MiB limit.",
      );
    }
  }
  throw new CalendarTransportError(
    "The calendar feed redirected too many times.",
  );
}
