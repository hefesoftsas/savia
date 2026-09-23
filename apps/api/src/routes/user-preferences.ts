import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { actorFromContext } from "../auth/middleware";
import {
  appearanceColorThemeIds,
  AppearancePreferencesError,
  defaultAppearancePreferences,
  defaultMyDayWidgets,
  defaultSidebarNavigationLayout,
  legacySidebarNavigationItemIds,
  MyDayWidgetsError,
  parseAppearancePreferences,
  parseMyDayWidgets,
  parseSidebarNavigationLayout,
  SidebarNavigationLayoutError,
  sidebarNavigationItemIds,
} from "../user-preferences/contracts";
import { createUserPreferencesRepository } from "../user-preferences/repository";

const sidebarNavigationItemSchema = z.union([
  z.enum(sidebarNavigationItemIds),
  // Legacy alias: stored layouts may still carry the pre-Studio item id.
  z.enum(legacySidebarNavigationItemIds),
  z.string().regex(/^page:[a-zA-Z0-9_%.-]{1,160}:[a-z][a-z0-9_]{0,47}$/),
]);

const sidebarNavigationBlockSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("builtin"),
    id: z.enum(["operation", "productivity", "administration", "management"]),
    items: z.array(sidebarNavigationItemSchema),
    collapsed: z.boolean(),
  }),
  z.object({
    kind: z.literal("custom"),
    id: z.string().regex(/^custom:[a-z0-9_-]{1,48}$/),
    label: z.string().trim().min(1).max(40),
    items: z.array(sidebarNavigationItemSchema),
    collapsed: z.boolean(),
  }),
]);

const sidebarNavigationLayoutSchema = z.object({
  version: z.literal(2),
  presetVersion: z.literal(2).optional(),
  blocks: z.array(sidebarNavigationBlockSchema),
  hiddenItems: z.array(sidebarNavigationItemSchema).optional(),
});

const sidebarNavigationResponseSchema = z.object({
  data: sidebarNavigationLayoutSchema,
});

const invalidSidebarNavigationResponseSchema = z.object({
  error: z.object({
    code: z.literal("INVALID_SIDEBAR_NAVIGATION"),
    message: z.string(),
  }),
});

const appearancePreferencesSchema = z.object({
  version: z.literal(1),
  theme: z.enum(["light", "dark", "system"]),
  colorTheme: z.enum(appearanceColorThemeIds),
});

const appearanceResponseSchema = z.object({
  data: appearancePreferencesSchema,
});

const invalidAppearanceResponseSchema = z.object({
  error: z.object({
    code: z.literal("INVALID_APPEARANCE_PREFERENCES"),
    message: z.string(),
  }),
});

const myDayCollectionWidgetSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]{1,48}$/),
  apiBasePath: z
    .string()
    .regex(
      /^\/v1\/(data-domains\/[a-z][a-z0-9_-]{0,47}|(?:studio|dynamic-crm)\/[1-9][0-9]*)$/,
    ),
  collection: z.string().regex(/^[a-z][a-z0-9_]{0,47}$/),
  kind: z.union([
    z.enum(["summary", "items", "chart", "actions"]),
    z.string().regex(/^plugin:[a-z0-9_.-]{1,64}:[a-z0-9_-]{1,64}$/),
  ]),
  title: z.string().trim().min(1).max(80).optional(),
  config: z
    .object({
      statusField: z
        .string()
        .regex(/^[a-z][a-z0-9_]{0,47}$/)
        .optional(),
      amountField: z
        .string()
        .regex(/^[a-z][a-z0-9_]{0,47}$/)
        .optional(),
      dateField: z
        .string()
        .regex(/^[a-z][a-z0-9_]{0,47}$/)
        .optional(),
      groupField: z
        .string()
        .regex(/^[a-z][a-z0-9_]{0,47}$/)
        .optional(),
      limit: z.number().int().min(1).max(10).optional(),
      sort: z
        .string()
        .regex(/^[a-z][a-z0-9_]{0,47}$/)
        .optional(),
      order: z.enum(["ASC", "DESC"]).optional(),
    })
    .strict()
    .optional(),
  size: z.enum(["sm", "md", "lg"]).optional(),
});

const myDaySystemWidgetSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]{1,48}$/),
  kind: z.enum(["agenda", "quick_task"]),
  title: z.string().trim().min(1).max(80).optional(),
  size: z.enum(["sm", "md", "lg"]).optional(),
});

const myDayWidgetSchema = z.union([
  myDayCollectionWidgetSchema,
  myDaySystemWidgetSchema,
]);

const myDayWidgetsLayoutSchema = z.object({
  version: z.literal(1),
  widgets: z.array(myDayWidgetSchema).max(12),
});

const myDayWidgetsResponseSchema = z.object({
  data: myDayWidgetsLayoutSchema,
});

const invalidMyDayWidgetsResponseSchema = z.object({
  error: z.object({
    code: z.literal("INVALID_MY_DAY_WIDGETS"),
    message: z.string(),
  }),
});

const getSidebarNavigationRoute = createRoute({
  method: "get",
  path: "/v1/user-preferences/sidebar-navigation",
  tags: ["User preferences"],
  summary: "Read the caller's sidebar navigation layout",
  security: [{ oauth2: ["savia.api.read"] }],
  responses: {
    200: {
      content: {
        "application/json": { schema: sidebarNavigationResponseSchema },
      },
      description: "Sidebar navigation layout",
    },
  },
});

const saveSidebarNavigationRoute = createRoute({
  method: "put",
  path: "/v1/user-preferences/sidebar-navigation",
  tags: ["User preferences"],
  summary: "Save the caller's sidebar navigation layout",
  security: [{ oauth2: ["savia.api.write"] }],
  request: {
    body: {
      content: {
        "application/json": { schema: z.unknown() },
      },
      required: true,
    },
  },
  responses: {
    200: {
      content: {
        "application/json": { schema: sidebarNavigationResponseSchema },
      },
      description: "Saved sidebar navigation layout",
    },
    400: {
      content: {
        "application/json": {
          schema: invalidSidebarNavigationResponseSchema,
        },
      },
      description: "Invalid sidebar navigation layout",
    },
  },
});

const getAppearanceRoute = createRoute({
  method: "get",
  path: "/v1/user-preferences/appearance",
  tags: ["User preferences"],
  summary: "Read the caller's appearance preferences",
  security: [{ oauth2: ["savia.api.read"] }],
  responses: {
    200: {
      content: {
        "application/json": { schema: appearanceResponseSchema },
      },
      description: "Appearance preferences",
    },
  },
});

const saveAppearanceRoute = createRoute({
  method: "put",
  path: "/v1/user-preferences/appearance",
  tags: ["User preferences"],
  summary: "Save the caller's appearance preferences",
  security: [{ oauth2: ["savia.api.write"] }],
  request: {
    body: {
      content: {
        "application/json": { schema: z.unknown() },
      },
      required: true,
    },
  },
  responses: {
    200: {
      content: {
        "application/json": { schema: appearanceResponseSchema },
      },
      description: "Saved appearance preferences",
    },
    400: {
      content: {
        "application/json": {
          schema: invalidAppearanceResponseSchema,
        },
      },
      description: "Invalid appearance preferences",
    },
  },
});

const getMyDayWidgetsRoute = createRoute({
  method: "get",
  path: "/v1/user-preferences/my-day-widgets",
  tags: ["User preferences"],
  summary: "Read the caller's My Day widgets layout",
  security: [{ oauth2: ["savia.api.read"] }],
  responses: {
    200: {
      content: {
        "application/json": { schema: myDayWidgetsResponseSchema },
      },
      description: "My Day widgets layout",
    },
  },
});

const saveMyDayWidgetsRoute = createRoute({
  method: "put",
  path: "/v1/user-preferences/my-day-widgets",
  tags: ["User preferences"],
  summary: "Save the caller's My Day widgets layout",
  security: [{ oauth2: ["savia.api.write"] }],
  request: {
    body: {
      content: {
        "application/json": { schema: z.unknown() },
      },
      required: true,
    },
  },
  responses: {
    200: {
      content: {
        "application/json": { schema: myDayWidgetsResponseSchema },
      },
      description: "Saved My Day widgets layout",
    },
    400: {
      content: {
        "application/json": {
          schema: invalidMyDayWidgetsResponseSchema,
        },
      },
      description: "Invalid My Day widgets layout",
    },
  },
});

export function registerUserPreferenceRoutes(
  app: OpenAPIHono,
  database: D1Database,
): void {
  const preferences = createUserPreferencesRepository(database);

  app.openapi(getSidebarNavigationRoute, async (context) => {
    const principalId = actorFromContext(context).principal.id;
    const layout =
      (await preferences.getSidebarNavigation(principalId)) ??
      defaultSidebarNavigationLayout();
    return context.json({ data: layout }, 200);
  });

  app.openapi(saveSidebarNavigationRoute, async (context) => {
    try {
      const layout = parseSidebarNavigationLayout(context.req.valid("json"));
      const saved = await preferences.saveSidebarNavigation(
        actorFromContext(context).principal.id,
        layout,
      );
      return context.json({ data: saved }, 200);
    } catch (error) {
      if (error instanceof SidebarNavigationLayoutError) {
        return context.json(
          {
            error: {
              code: "INVALID_SIDEBAR_NAVIGATION" as const,
              message: "La organización del menú no es válida.",
            },
          },
          400,
        );
      }
      throw error;
    }
  });

  app.openapi(getAppearanceRoute, async (context) => {
    const principalId = actorFromContext(context).principal.id;
    const settings =
      (await preferences.getAppearance(principalId)) ??
      defaultAppearancePreferences();
    return context.json({ data: settings }, 200);
  });

  app.openapi(saveAppearanceRoute, async (context) => {
    try {
      const settings = parseAppearancePreferences(context.req.valid("json"));
      const saved = await preferences.saveAppearance(
        actorFromContext(context).principal.id,
        settings,
      );
      return context.json({ data: saved }, 200);
    } catch (error) {
      if (error instanceof AppearancePreferencesError) {
        return context.json(
          {
            error: {
              code: "INVALID_APPEARANCE_PREFERENCES" as const,
              message: "Las preferencias de apariencia no son válidas.",
            },
          },
          400,
        );
      }
      throw error;
    }
  });

  app.openapi(getMyDayWidgetsRoute, async (context) => {
    const principalId = actorFromContext(context).principal.id;
    const layout =
      (await preferences.getMyDayWidgets(principalId)) ?? defaultMyDayWidgets();
    return context.json({ data: layout }, 200);
  });

  app.openapi(saveMyDayWidgetsRoute, async (context) => {
    try {
      const layout = parseMyDayWidgets(context.req.valid("json"));
      const saved = await preferences.saveMyDayWidgets(
        actorFromContext(context).principal.id,
        layout,
      );
      return context.json({ data: saved }, 200);
    } catch (error) {
      if (error instanceof MyDayWidgetsError) {
        return context.json(
          {
            error: {
              code: "INVALID_MY_DAY_WIDGETS" as const,
              message: "Los widgets de Mi día no son válidos.",
            },
          },
          400,
        );
      }
      throw error;
    }
  });
}
