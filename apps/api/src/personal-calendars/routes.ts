import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import {
  calendarLimits,
  calendarPreferencesSchema,
  calendarRangeSchema,
  calendarSourceEventsSchema,
  calendarSourceSchema,
  createCalendarSourceSchema,
  updateCalendarSourceSchema,
} from "@savia/studio-shared/calendar-contracts";
import { actorFromContext } from "../auth/middleware";
import { CalendarCipherUnavailableError } from "./cipher";
import {
  CalendarSourceInputError,
  CalendarSourceLimitError,
  CalendarSourceNotFoundError,
} from "./repository";
import { CalendarIcalError } from "./ical";
import { CalendarTransportError } from "./transport";
import {
  PersonalCalendarService,
  PersonalCalendarServiceError,
} from "./service";

const sourceResponse = z.object({ data: calendarSourceSchema });
const sourcesResponse = z.object({ data: z.array(calendarSourceSchema) });
const preferencesResponse = z.object({ data: calendarPreferencesSchema });
const sourceParams = z.object({ id: z.string().min(1).max(100) });

const listSources = createRoute({
  method: "get",
  path: "/v1/personal-integrations/calendars",
  tags: ["Personal integrations"],
  summary: "List shared calendar sources",
  security: [{ oauth2: ["savia.api.read"] }],
  responses: {
    200: {
      content: { "application/json": { schema: sourcesResponse } },
      description: "Calendar sources",
    },
  },
});
const createSource = createRoute({
  method: "post",
  path: "/v1/personal-integrations/calendars",
  tags: ["Personal integrations"],
  summary: "Add a shared calendar source",
  security: [{ oauth2: ["savia.api.write"] }],
  request: {
    body: {
      content: { "application/json": { schema: createCalendarSourceSchema } },
    },
  },
  responses: {
    201: {
      content: { "application/json": { schema: sourceResponse } },
      description: "Created calendar source",
    },
    400: { description: "Invalid calendar source" },
    413: { description: "Calendar content exceeds the size limit" },
  },
});
const updateSource = createRoute({
  method: "patch",
  path: "/v1/personal-integrations/calendars/{id}",
  tags: ["Personal integrations"],
  summary: "Update a shared calendar source",
  security: [{ oauth2: ["savia.api.write"] }],
  request: {
    params: sourceParams,
    body: {
      content: { "application/json": { schema: updateCalendarSourceSchema } },
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: sourceResponse } },
      description: "Updated calendar source",
    },
    404: { description: "Calendar source not found" },
  },
});
const deleteSource = createRoute({
  method: "delete",
  path: "/v1/personal-integrations/calendars/{id}",
  tags: ["Personal integrations"],
  summary: "Delete a shared calendar source",
  security: [{ oauth2: ["savia.api.write"] }],
  request: { params: sourceParams },
  responses: {
    204: { description: "Calendar source deleted" },
    404: { description: "Calendar source not found" },
  },
});
const readSourceEvents = createRoute({
  method: "get",
  path: "/v1/personal-integrations/calendars/{id}/events",
  tags: ["Personal integrations"],
  summary: "Read shared calendar events",
  security: [{ oauth2: ["savia.api.read"] }],
  request: { params: sourceParams, query: calendarRangeSchema },
  responses: {
    200: {
      content: { "application/json": { schema: calendarSourceEventsSchema } },
      description: "Events for the requested range",
    },
    404: { description: "Calendar source not found" },
    422: { description: "Invalid or overlong range" },
  },
});
const refreshSource = createRoute({
  method: "post",
  path: "/v1/personal-integrations/calendars/{id}/refresh",
  tags: ["Personal integrations"],
  summary: "Refresh a shared calendar subscription",
  security: [{ oauth2: ["savia.api.write"] }],
  request: { params: sourceParams },
  responses: {
    200: {
      content: { "application/json": { schema: sourceResponse } },
      description: "Refreshed calendar source",
    },
    404: { description: "Calendar source not found" },
    422: { description: "Imported copies cannot be refreshed" },
  },
});
const getPreferencesRoute = createRoute({
  method: "get",
  path: "/v1/user-preferences/calendar",
  tags: ["User preferences"],
  summary: "Read calendar visibility preferences",
  security: [{ oauth2: ["savia.api.read"] }],
  responses: {
    200: {
      content: { "application/json": { schema: preferencesResponse } },
      description: "Calendar visibility preferences",
    },
  },
});
const savePreferencesRoute = createRoute({
  method: "put",
  path: "/v1/user-preferences/calendar",
  tags: ["User preferences"],
  summary: "Save calendar visibility preferences",
  security: [{ oauth2: ["savia.api.write"] }],
  request: {
    body: {
      content: { "application/json": { schema: calendarPreferencesSchema } },
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: preferencesResponse } },
      description: "Saved calendar visibility preferences",
    },
    400: { description: "Invalid preferences" },
  },
});

function responseError(error: unknown): {
  status: 400 | 404 | 413 | 422 | 503;
  code: string;
  message: string;
} | null {
  if (error instanceof CalendarSourceNotFoundError)
    return {
      status: 404,
      code: "CALENDAR_SOURCE_NOT_FOUND",
      message: "Calendar source not found.",
    };
  if (error instanceof CalendarSourceLimitError)
    return {
      status: 422,
      code: "CALENDAR_SOURCE_LIMIT",
      message: error.message,
    };
  if (
    error instanceof CalendarIcalError ||
    error instanceof CalendarTransportError ||
    error instanceof CalendarSourceInputError ||
    error instanceof PersonalCalendarServiceError
  ) {
    const isLimit = /1 MiB|1,?024|2,000|100,000|62 days/i.test(error.message);
    return {
      status: isLimit ? 413 : 422,
      code: "INVALID_CALENDAR_SOURCE",
      message: error.message,
    };
  }
  if (error instanceof CalendarCipherUnavailableError)
    return {
      status: 503,
      code: "CALENDAR_ENCRYPTION_UNAVAILABLE",
      message: "Calendar storage is unavailable.",
    };
  if (error instanceof z.ZodError)
    return {
      status: 400,
      code: "INVALID_CALENDAR_INPUT",
      message: "The calendar request is invalid.",
    };
  return null;
}

export function registerPersonalCalendarRoutes(
  app: OpenAPIHono,
  database: D1Database,
  options: { secret?: string; fetcher?: typeof fetch } = {},
): void {
  const service = new PersonalCalendarService(database, options);
  app.openapi(listSources, async (context) =>
    context.json(
      { data: await service.list(actorFromContext(context).principal.id) },
      200,
    ),
  );
  app.openapi(createSource, async (context) => {
    try {
      const data = await service.create(
        actorFromContext(context).principal.id,
        context.req.valid("json"),
      );
      return context.json({ data }, 201);
    } catch (error) {
      const mapped = responseError(error);
      if (mapped)
        return context.json(
          { error: { code: mapped.code, message: mapped.message } },
          mapped.status as 400 | 413 | 422 | 503,
        );
      throw error;
    }
  });
  app.openapi(updateSource, async (context) => {
    try {
      const data = await service.update(
        actorFromContext(context).principal.id,
        context.req.valid("param").id,
        context.req.valid("json"),
      );
      return context.json({ data }, 200);
    } catch (error) {
      const mapped = responseError(error);
      if (mapped)
        return context.json(
          { error: { code: mapped.code, message: mapped.message } },
          mapped.status as 400 | 413 | 422 | 503,
        );
      throw error;
    }
  });
  app.openapi(deleteSource, async (context) => {
    try {
      await service.delete(
        actorFromContext(context).principal.id,
        context.req.valid("param").id,
      );
      return context.body(null, 204);
    } catch (error) {
      const mapped = responseError(error);
      if (mapped)
        return context.json(
          { error: { code: mapped.code, message: mapped.message } },
          mapped.status as 400 | 413 | 422 | 503,
        );
      throw error;
    }
  });
  app.openapi(readSourceEvents, async (context) => {
    try {
      const params = context.req.valid("param");
      const query = context.req.valid("query");
      return context.json(
        await service.events(
          actorFromContext(context).principal.id,
          params.id,
          {
            ...query,
            refresh: query.refresh === "true",
          },
        ),
        200,
      );
    } catch (error) {
      const mapped = responseError(error);
      if (mapped)
        return context.json(
          { error: { code: mapped.code, message: mapped.message } },
          mapped.status as 400 | 413 | 422 | 503,
        );
      throw error;
    }
  });
  app.openapi(refreshSource, async (context) => {
    try {
      const data = await service.refresh(
        actorFromContext(context).principal.id,
        context.req.valid("param").id,
      );
      return context.json({ data }, 200);
    } catch (error) {
      const mapped = responseError(error);
      if (mapped)
        return context.json(
          { error: { code: mapped.code, message: mapped.message } },
          mapped.status as 400 | 413 | 422 | 503,
        );
      throw error;
    }
  });
  app.openapi(getPreferencesRoute, async (context) =>
    context.json(
      {
        data: await service.getPreferences(
          actorFromContext(context).principal.id,
        ),
      },
      200,
    ),
  );
  app.openapi(savePreferencesRoute, async (context) => {
    try {
      return context.json(
        {
          data: await service.savePreferences(
            actorFromContext(context).principal.id,
            context.req.valid("json"),
          ),
        },
        200,
      );
    } catch (error) {
      const mapped = responseError(error);
      if (mapped)
        return context.json(
          { error: { code: mapped.code, message: mapped.message } },
          mapped.status as 400 | 413 | 422 | 503,
        );
      throw error;
    }
  });
}
