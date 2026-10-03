import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import { bodyLimit } from "hono/body-limit";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { actorFromContext } from "../auth/middleware";
import { authorizeBranding } from "../tenant-branding/service";
import {
  captchaConfiguration,
  captchaIdentity,
  publicFormChallenge,
  verifyCaptcha,
  type CaptchaOptions,
} from "../public-forms/captcha";
import { createPersonalIntegrationRepository } from "../personal-integrations/repository";
import type { PersonalIntegrationNangoClient } from "../personal-integrations/contracts";
import { createBookingCalendarAdapter } from "./calendar";
import {
  bootstrapSchema,
  settingsSchema,
  reservationSchema,
  revisionSchema,
  ownAvailabilitySchema,
  calendarGrantSchema,
  publicBookingSchema,
  slotQuerySchema,
  type BookingSettings,
} from "./contracts";
import { digest, dateInZone, slotsForDate } from "./domain";
import {
  candidates,
  readSettings,
  saveSettings,
  publishedSettings,
  readGrant,
  nativeBusy,
  findRequest,
  createReservation,
  managedBooking,
  reservationView,
  changeReservation,
  readBooking,
  type BookingRow,
} from "./repository";

export type BookingOptions = {
  captcha?: CaptchaOptions;
  nango?: PersonalIntegrationNangoClient;
  now?: () => number;
};
const unavailable = () =>
  new HTTPException(503, {
    message:
      "Calendar availability is temporarily unavailable. Reconnect your calendar or try again.",
  });
const conflict = () =>
  new HTTPException(409, {
    message: "That time is no longer available. Choose another time.",
  });
const params = z.object({ tenantId: z.coerce.number().int().positive() });
const objectResponse = z.record(z.string(), z.unknown());
const rangeSchema = z
  .object({
    from: z.string().datetime({ offset: true }),
    to: z.string().datetime({ offset: true }),
  })
  .refine(
    (v) =>
      Date.parse(v.to) > Date.parse(v.from) &&
      Date.parse(v.to) - Date.parse(v.from) <= 93 * 86400000,
  );
function parsed<T>(schema: z.ZodType<T>, value: unknown): T {
  const p = schema.safeParse(value);
  if (!p.success)
    throw new HTTPException(422, {
      message: p.error.issues[0]?.message ?? "Invalid input.",
    });
  return p.data;
}
async function body<T>(c: Context, schema: z.ZodType<T>): Promise<T> {
  let value: unknown;
  try {
    value = await c.req.json();
  } catch {
    throw new HTTPException(400, { message: "Send a JSON object." });
  }
  return parsed(schema, value);
}
function origin(options: BookingOptions) {
  return options.captcha?.publicOrigin ?? "http://localhost:5173";
}
const pageUrl = (options: BookingOptions, token: string) =>
  new URL(`/public/bookings/${token}`, origin(options)).toString();
const manageUrl = (options: BookingOptions, token: string) =>
  new URL(`/public/bookings/manage/${token}`, origin(options)).toString();
export function registerBookingRoutes(
  app: OpenAPIHono,
  db: D1Database,
  options: BookingOptions = {},
) {
  const now = options.now ?? Date.now;
  const calendar = options.nango
    ? createBookingCalendarAdapter(db, options.nango)
    : undefined;
  const captcha = {
    ...options.captcha,
    rateLimiter: options.captcha?.rateLimiter ?? {
      limit: async () => ({ success: true }),
    },
  };
  const limitBody = bodyLimit({
    maxSize: 64 * 1024,
    onError: (c) => c.json({ error: "Request is too large." }, 413),
  });
  app.use("/v1/tenants/:tenantId/booking", limitBody);
  app.use("/v1/tenants/:tenantId/booking/*", limitBody);
  app.use("/api/public/bookings/*", limitBody);
  app.use("/api/public/bookings/*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    c.header("X-Robots-Tag", "noindex, nofollow");
    c.header("Referrer-Policy", "no-referrer");
    const window = Math.floor(now() / 60000),
      ip = c.req.header("cf-connecting-ip") ?? "unknown";
    const bucket = await digest(
      `${window}:${ip}:${c.req.method === "GET" ? "read" : "write"}:${c.req.path.split("/")[4] === "manage" ? c.req.path.split("/")[5] : c.req.path.split("/")[4]}`,
    );
    const row = await db
      .prepare(
        "INSERT INTO tenant_booking_rate_limits(bucket,count,expires_at) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=tenant_booking_rate_limits.count+1 RETURNING count",
      )
      .bind(bucket, now() + 120000)
      .first<{ count: number }>();
    if (!row || row.count > (c.req.method === "GET" ? 120 : 20))
      throw new HTTPException(429, {
        message: "Too many booking requests. Try again shortly.",
      });
    if (
      options.captcha?.rateLimiter &&
      !(
        await options.captcha.rateLimiter.limit({
          key: `booking:${await digest(ip)}`,
        })
      ).success
    )
      throw new HTTPException(429, { message: "Too many requests." });
    await next();
  });
  function route(
    method: "get" | "put" | "post",
    path: string,
    handler: (c: Context) => Promise<Response>,
    input?: z.ZodType,
    query?: z.ZodObject,
    response: z.ZodType = objectResponse,
    created = false,
  ) {
    app.openAPIRegistry.registerPath(
      createRoute({
        method,
        path,
        tags: ["Booking"],
        security: path.startsWith("/api/public") ? [] : undefined,
        request: {
          params: z.object({
            ...(path.includes("{tenantId}") ? params.shape : {}),
            ...(path.includes("{id}") ? { id: z.string().uuid() } : {}),
            ...(path.includes("{token}") ? { token: z.string() } : {}),
          }),
          ...(input
            ? {
                body: {
                  required: true,
                  content: { "application/json": { schema: input } },
                },
              }
            : {}),
          ...(query ? { query } : {}),
        },
        responses: {
          200: {
            description: "Booking response",
            content: {
              "application/json": { schema: z.object({ data: response }) },
            },
          },
          ...(created
            ? {
                201: {
                  description: "Confirmed reservation",
                  content: {
                    "application/json": {
                      schema: z.object({ data: response }),
                    },
                  },
                },
              }
            : {}),
          400: { description: "Malformed input" },
          403: { description: "Access or verification denied" },
          404: { description: "Unavailable resource" },
          409: { description: "Slot or revision conflict" },
          422: { description: "Invalid input" },
          429: { description: "Request limit" },
          503: { description: "Provider unavailable" },
        },
      }),
    );
    app.on(method.toUpperCase(), path.replace(/\{([^}]+)\}/g, ":$1"), handler);
  }
  const tenant = (c: Context) =>
    parsed(params, { tenantId: c.req.param("tenantId") }).tenantId;
  async function authorizeHistory(c: Context, id: number) {
    const actor = actorFromContext(c),
      platform = actor.globalRoles.includes("platform_admin"),
      own = actor.memberships.filter(
        (m) => m.isActive && (m.tenantId ?? m.agencyId) === id,
      );
    if (!actor.principal.isActive || (!platform && !own.length))
      throw new HTTPException(403, { message: "Reservation access denied." });
    const tenant = await db
      .prepare("SELECT 1 FROM tenants WHERE id=? AND kind='commercial'")
      .bind(id)
      .first();
    if (!tenant)
      throw new HTTPException(404, { message: "Tenant unavailable." });
    return {
      canManage:
        platform ||
        own.some((m) => ["tenant_admin", "agency_admin"].includes(m.role)),
    };
  }
  async function bootstrap(c: Context, id: number) {
    const actor = actorFromContext(c),
      auth = await authorizeBranding(db, actor, id),
      state = await readSettings(db, id, auth.tenant.name),
      eligible = await candidates(db, id);
    const grant = await readGrant(db, id, actor.principal.id);
    const connection = grant
      ? await createPersonalIntegrationRepository(db).findActiveConnection(
          actor.principal.id,
          grant.provider,
        )
      : null;
    return {
      settings: auth.canManage
        ? state.settings
        : {
            ...state.settings,
            professionals: state.settings.professionals.filter(
              (p) => p.principalId === actor.principal.id,
            ),
            services: state.settings.services
              .filter((s) =>
                s.professionalIds.some((p) =>
                  state.settings.professionals.some(
                    (x) => x.id === p && x.principalId === actor.principal.id,
                  ),
                ),
              )
              .map((s) => ({
                ...s,
                professionalIds: s.professionalIds.filter((p) =>
                  state.settings.professionals.some(
                    (x) => x.id === p && x.principalId === actor.principal.id,
                  ),
                ),
              })),
          },
      candidates: auth.canManage
        ? eligible
        : eligible.filter((p) => p.principalId === actor.principal.id),
      canManage: auth.canManage,
      principalId: actor.principal.id,
      publicUrl: state.publicToken ? pageUrl(options, state.publicToken) : null,
      calendar: {
        provider: grant?.provider ?? null,
        status: !grant
          ? "not_connected"
          : connection?.id === grant.connection_id &&
              connection.status === "connected"
            ? "connected"
            : "reconnect_required",
      },
    };
  }
  async function slots(
    state: { tenantId: number; settings: BookingSettings },
    query: z.infer<typeof slotQuerySchema>,
    exceptId?: string,
  ) {
    const professional = state.settings.professionals.find(
        (p) => p.id === query.professionalId && p.enabled,
      ),
      service = state.settings.services.find(
        (s) =>
          s.id === query.serviceId &&
          s.enabled &&
          s.professionalIds.includes(query.professionalId),
      );
    if (!professional || !service)
      throw new HTTPException(404, {
        message: "Service or professional unavailable.",
      });
    const eligible = await candidates(db, state.tenantId);
    if (!eligible.some((p) => p.principalId === professional.principalId))
      throw conflict();
    const center = Date.parse(`${query.date}T12:00:00Z`);
    if (Math.abs(center - now()) > 183 * 86400000)
      throw new HTTPException(422, {
        message: "Choose a date in the booking horizon.",
      });
    const from = new Date(center - 36 * 3600000).toISOString(),
      to = new Date(center + 36 * 3600000).toISOString();
    const busy = await nativeBusy(
        db,
        state.tenantId,
        professional.principalId,
        from,
        to,
        exceptId,
      ),
      grant = await readGrant(db, state.tenantId, professional.principalId);
    if (grant) {
      if (!calendar) throw unavailable();
      try {
        busy.push(
          ...(await calendar.busy({
            principalId: professional.principalId,
            provider: grant.provider,
            connectionId: grant.connection_id,
            from,
            to,
          })),
        );
      } catch {
        throw unavailable();
      }
    }
    return {
      professional,
      service,
      grant,
      professionalName: eligible.find(
        (p) => p.principalId === professional.principalId,
      )!.displayName,
      slots: slotsForDate(
        state.settings,
        professional,
        service,
        query.date,
        busy,
        now(),
      ),
      timeZone: state.settings.timeZone,
    };
  }
  const root = "/v1/tenants/{tenantId}/booking";
  route(
    "get",
    root,
    async (c) => c.json({ data: await bootstrap(c, tenant(c)) }),
    undefined,
    undefined,
    bootstrapSchema,
  );
  route(
    "put",
    root,
    async (c) => {
      const id = tenant(c);
      await authorizeBranding(db, actorFromContext(c), id, true);
      await saveSettings(db, id, await body(c, settingsSchema));
      return c.json({ data: await bootstrap(c, id) });
    },
    settingsSchema,
    undefined,
    bootstrapSchema,
  );
  route(
    "put",
    `${root}/availability`,
    async (c) => {
      const id = tenant(c),
        actor = actorFromContext(c);
      await authorizeBranding(db, actor, id);
      const input = await body(c, ownAvailabilitySchema),
        state = await readSettings(db, id);
      if (
        !state.settings.professionals.some(
          (p) => p.principalId === actor.principal.id && p.enabled,
        )
      )
        throw new HTTPException(403, {
          message: "An enabled professional is required.",
        });
      await saveSettings(
        db,
        id,
        parsed(settingsSchema, {
          ...state.settings,
          version: input.version,
          professionals: state.settings.professionals.map((p) =>
            p.principalId === actor.principal.id
              ? { ...p, weekly: input.weekly, exceptions: input.exceptions }
              : p,
          ),
        }),
      );
      return c.json({ data: await bootstrap(c, id) });
    },
    ownAvailabilitySchema,
    undefined,
    bootstrapSchema,
  );
  route(
    "put",
    `${root}/calendar`,
    async (c) => {
      const id = tenant(c),
        actor = actorFromContext(c);
      await authorizeBranding(db, actor, id);
      const input = await body(c, calendarGrantSchema);
      if (input.provider === null) {
        await db
          .prepare(
            "DELETE FROM tenant_booking_calendar_grants WHERE tenant_id=? AND principal_id=?",
          )
          .bind(id, actor.principal.id)
          .run();
      } else {
        const state = await readSettings(db, id);
        if (
          !state.settings.professionals.some(
            (p) => p.principalId === actor.principal.id && p.enabled,
          )
        )
          throw new HTTPException(403, {
            message: "An enabled professional is required.",
          });
        const connection = await createPersonalIntegrationRepository(
          db,
        ).findActiveConnection(actor.principal.id, input.provider);
        if (!calendar || !connection || connection.status !== "connected")
          throw unavailable();
        await db
          .prepare(
            "INSERT INTO tenant_booking_calendar_grants(tenant_id,principal_id,provider,connection_id) VALUES(?,?,?,?) ON CONFLICT(tenant_id,principal_id) DO UPDATE SET provider=excluded.provider,connection_id=excluded.connection_id",
          )
          .bind(id, actor.principal.id, input.provider, connection.id)
          .run();
      }
      return c.json({ data: await bootstrap(c, id) });
    },
    calendarGrantSchema,
    undefined,
    bootstrapSchema,
  );
  route(
    "get",
    `${root}/reservations`,
    async (c) => {
      const id = tenant(c),
        actor = actorFromContext(c),
        auth = await authorizeHistory(c, id);
      const range = parsed(rangeSchema, {
        from:
          c.req.query("from") ?? new Date(now() - 7 * 86400000).toISOString(),
        to: c.req.query("to") ?? new Date(now() + 60 * 86400000).toISOString(),
      });
      const r = await db
        .prepare(
          `SELECT * FROM tenant_bookings WHERE tenant_id=? AND starts_at>=? AND starts_at<? ${auth.canManage ? "" : "AND principal_id=?"} ORDER BY starts_at LIMIT 500`,
        )
        .bind(
          id,
          new Date(range.from).toISOString(),
          new Date(range.to).toISOString(),
          ...(auth.canManage ? [] : [actor.principal.id]),
        )
        .all<BookingRow>();
      return c.json({
        data: await Promise.all(r.results.map((r) => reservationView(db, r))),
      });
    },
    undefined,
    rangeSchema,
    z.array(reservationSchema),
  );
  route(
    "post",
    `${root}/reservations/{id}/cancel`,
    async (c) => {
      const id = tenant(c),
        actor = actorFromContext(c),
        auth = await authorizeHistory(c, id),
        input = await body(c, revisionSchema),
        row = await readBooking(db, id, c.req.param("id")!);
      if (!row)
        throw new HTTPException(404, { message: "Reservation unavailable." });
      if (!auth.canManage && row.principal_id !== actor.principal.id)
        throw new HTTPException(403, { message: "Reservation access denied." });
      const state = await readSettings(db, id);
      const changed = await changeReservation(db, row, state.settings, {
        version: input.version,
        cancel: true,
      });
      return c.json({ data: await reservationView(db, changed) });
    },
    revisionSchema,
    undefined,
    reservationSchema,
  );
  const publicRoot = "/api/public/bookings/{token}";
  route("get", publicRoot, async (c) => {
    const state = await publishedSettings(db, c.req.param("token")!),
      eligible = await candidates(db, state.tenantId);
    const professionals = state.settings.professionals
      .filter(
        (p) =>
          p.enabled && eligible.some((e) => e.principalId === p.principalId),
      )
      .map((p) => ({
        id: p.id,
        name: eligible.find((e) => e.principalId === p.principalId)!
          .displayName,
      }));
    const config = captchaConfiguration(captcha);
    return c.json({
      data: {
        id: state.publicToken,
        title: state.settings.title,
        description: state.settings.description,
        timeZone: state.settings.timeZone,
        cancellationMinutes: state.settings.cancellationMinutes,
        services: state.settings.services
          .filter((s) => s.enabled)
          .map(
            ({ id, name, description, durationMinutes, professionalIds }) => ({
              id,
              name,
              description,
              durationMinutes,
              professionalIds: professionalIds.filter((id) =>
                professionals.some((p) => p.id === id),
              ),
            }),
          ),
        professionals,
        captcha: {
          captchaProvider: config.provider,
          ...(config.provider === "turnstile"
            ? { siteKey: config.siteKey }
            : {}),
        },
      },
    });
  });
  route("get", `${publicRoot}/challenge`, async (c) => {
    await publishedSettings(db, c.req.param("token")!);
    return c.json(await publicFormChallenge(captcha, c.req.param("token")!));
  });
  route(
    "get",
    `${publicRoot}/slots`,
    async (c) => {
      const state = await publishedSettings(db, c.req.param("token")!),
        result = await slots(state, parsed(slotQuerySchema, c.req.query()));
      return c.json({
        data: { slots: result.slots, timeZone: result.timeZone },
      });
    },
    undefined,
    slotQuerySchema,
  );
  route(
    "post",
    `${publicRoot}/reservations`,
    async (c) => {
      const token = c.req.param("token")!,
        state = await publishedSettings(db, token),
        input = await body(c, publicBookingSchema),
        key = parsed(
          z
            .string()
            .min(8)
            .max(150)
            .regex(/^[A-Za-z0-9_-]+$/),
          c.req.header("Idempotency-Key"),
        );
      const normalized = {
        ...input,
        startsAt: new Date(input.startsAt).toISOString(),
        customerEmail: input.customerEmail.toLowerCase(),
      };
      const hash = await digest(
          JSON.stringify({ ...normalized, captchaToken: undefined }),
        ),
        requestKey = `${token}:${key}`;
      const existing = await findRequest(db, state.tenantId, requestKey);
      const response = async (row: BookingRow, status: 200 | 201) =>
        c.json(
          {
            data: {
              reservation: await reservationView(db, row),
              managementUrl: manageUrl(options, row.manage_token),
            },
          },
          status,
        );
      if (existing) {
        if (existing.request_hash !== hash)
          throw new HTTPException(409, {
            message: "This request key was already used for different details.",
          });
        return response(existing, 200);
      }
      await verifyCaptcha(captcha, {
        token: input.captchaToken,
        submissionId: crypto.randomUUID(),
        formId: token,
        ip: c.req.header("cf-connecting-ip") ?? "unknown",
      });
      if (captchaConfiguration(captcha).provider !== "disabled") {
        const identity = captchaIdentity(captcha, input.captchaToken),
          bucket = `captcha:${await digest(identity.key)}`;
        const used = await db
          .prepare(
            "INSERT INTO tenant_booking_rate_limits(bucket,count,expires_at) VALUES(?,1,?) ON CONFLICT(bucket) DO NOTHING RETURNING count",
          )
          .bind(bucket, now() + 86400000)
          .first();
        if (!used)
          throw new HTTPException(403, {
            message: "Verification was already used. Complete a new challenge.",
          });
      }
      const result = await slots(state, {
          serviceId: input.serviceId,
          professionalId: input.professionalId,
          date: dateInZone(input.startsAt, state.settings.timeZone),
        }),
        selected = result.slots.find((s) => s.startsAt === normalized.startsAt);
      if (!selected) throw conflict();
      const row: BookingRow = {
        id: crypto.randomUUID(),
        tenant_id: state.tenantId,
        professional_id: input.professionalId,
        principal_id: result.professional.principalId,
        service_id: input.serviceId,
        service_name: result.service.name,
        professional_name: result.professionalName,
        starts_at: selected.startsAt,
        ends_at: selected.endsAt,
        buffer_minutes: result.service.bufferMinutes,
        customer_name: input.customerName,
        customer_email: normalized.customerEmail,
        manage_token:
          crypto.randomUUID().replaceAll("-", "") +
          crypto.randomUUID().replaceAll("-", ""),
        request_key: requestKey,
        request_hash: hash,
        status: "confirmed",
        version: 1,
        calendar_provider: result.grant?.provider ?? null,
        calendar_connection_id: result.grant?.connection_id ?? null,
        external_id: null,
        created_at: new Date(now()).toISOString(),
      };
      try {
        await createReservation(db, row, state.settings);
      } catch (e) {
        const replay = await findRequest(db, state.tenantId, requestKey);
        if (replay && replay.request_hash === hash)
          return response(replay, 200);
        throw e;
      }
      return response(row, 201);
    },
    publicBookingSchema,
    undefined,
    z.object({ reservation: reservationSchema, managementUrl: z.string() }),
    true,
  );
  const management = "/api/public/bookings/manage/{token}";
  route("get", management, async (c) => {
    const row = await managedBooking(db, c.req.param("token")!),
      state = await readSettings(db, row.tenant_id);
    return c.json({
      data: {
        reservation: await reservationView(db, row),
        publicUrl: state.publicToken
          ? pageUrl(options, state.publicToken)
          : null,
        timeZone: state.settings.timeZone,
        cancellationMinutes: state.settings.cancellationMinutes,
      },
    });
  });
  route(
    "get",
    `${management}/slots`,
    async (c) => {
      const row = await managedBooking(db, c.req.param("token")!),
        state = await readSettings(db, row.tenant_id);
      if (
        !state.settings.enabled ||
        !state.settings.published ||
        row.status !== "confirmed"
      )
        throw conflict();
      await publishedSettings(db, state.publicToken ?? "");
      const date = parsed(z.string().date(), c.req.query("date"));
      const result = await slots(
        { tenantId: row.tenant_id, settings: state.settings },
        {
          serviceId: row.service_id,
          professionalId: row.professional_id,
          date,
        },
        row.id,
      );
      return c.json({
        data: { slots: result.slots, timeZone: result.timeZone },
      });
    },
    undefined,
    z.object({ date: z.string() }),
  );
  const cutoff = (row: BookingRow, settings: BookingSettings) => {
    if (
      Date.parse(row.starts_at) - now() <
      settings.cancellationMinutes * 60000
    )
      throw new HTTPException(409, {
        message:
          "The cancellation or rescheduling deadline has passed. Contact the business.",
      });
  };
  route(
    "post",
    `${management}/cancel`,
    async (c) => {
      const row = await managedBooking(db, c.req.param("token")!),
        input = await body(c, revisionSchema),
        state = await readSettings(db, row.tenant_id);
      cutoff(row, state.settings);
      return c.json({
        data: await reservationView(
          db,
          await changeReservation(db, row, state.settings, {
            version: input.version,
            cancel: true,
          }),
        ),
      });
    },
    revisionSchema,
    undefined,
    reservationSchema,
  );
  const rescheduleSchema = z
    .object({
      version: z.number().int().positive(),
      startsAt: z.string().datetime({ offset: true }),
    })
    .strict();
  route(
    "post",
    `${management}/reschedule`,
    async (c) => {
      const row = await managedBooking(db, c.req.param("token")!),
        input = await body(c, rescheduleSchema),
        state = await readSettings(db, row.tenant_id);
      cutoff(row, state.settings);
      await publishedSettings(db, state.publicToken ?? "");
      if (
        !state.settings.enabled ||
        !state.settings.published ||
        row.version !== input.version ||
        row.status !== "confirmed"
      )
        throw conflict();
      const startsAt = new Date(input.startsAt).toISOString();
      if (startsAt === row.starts_at)
        return c.json({ data: await reservationView(db, row) });
      const result = await slots(
          { tenantId: row.tenant_id, settings: state.settings },
          {
            serviceId: row.service_id,
            professionalId: row.professional_id,
            date: dateInZone(startsAt, state.settings.timeZone),
          },
          row.id,
        ),
        selected = result.slots.find((s) => s.startsAt === startsAt);
      if (!selected) throw conflict();
      if (
        result.service.durationMinutes !==
          (Date.parse(row.ends_at) - Date.parse(row.starts_at)) / 60000 ||
        result.service.bufferMinutes !== row.buffer_minutes
      )
        throw new HTTPException(409, {
          message:
            "The service changed. Contact the business to update this reservation.",
        });
      return c.json({
        data: await reservationView(
          db,
          await changeReservation(db, row, state.settings, {
            version: input.version,
            startsAt: selected.startsAt,
            endsAt: selected.endsAt,
          }),
        ),
      });
    },
    rescheduleSchema,
    undefined,
    reservationSchema,
  );
}
