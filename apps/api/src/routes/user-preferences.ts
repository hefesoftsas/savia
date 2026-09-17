import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { actorFromContext } from "../auth/middleware";
import {
  appearanceColorThemeIds,
  AppearancePreferencesError,
  defaultAppearancePreferences,
  defaultSidebarNavigationLayout,
  parseAppearancePreferences,
  parseSidebarNavigationLayout,
  SidebarNavigationLayoutError,
  sidebarNavigationItemIds,
} from "../user-preferences/contracts";
import { createUserPreferencesRepository } from "../user-preferences/repository";

const sidebarNavigationItemSchema = z.union([
  z.enum(sidebarNavigationItemIds),
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
        "application/json": { schema: invalidAppearanceResponseSchema },
      },
      description: "Invalid appearance preferences",
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
}
