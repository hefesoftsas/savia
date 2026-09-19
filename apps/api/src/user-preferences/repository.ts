import {
  parseAppearancePreferences,
  parseSidebarNavigationLayout,
  type AppearancePreferences,
  type SidebarNavigationLayout,
  type UserPreferencesRepository,
} from "./contracts";

type UserNavigationPreferenceRow = {
  layout: string;
};

type UserAppearancePreferenceRow = {
  settings: string;
};

function parseStoredLayout(value: string): SidebarNavigationLayout {
  try {
    return parseSidebarNavigationLayout(JSON.parse(value) as unknown);
  } catch (error) {
    if (error instanceof Error) {
      throw new Error("Stored sidebar navigation layout is invalid", {
        cause: error,
      });
    }
    throw error;
  }
}

export function createUserPreferencesRepository(
  database: D1Database,
): UserPreferencesRepository {
  return {
    async getSidebarNavigation(principalId) {
      const row = await database
        .prepare(
          `SELECT layout FROM user_navigation_preferences
           WHERE principal_id = ? LIMIT 1`,
        )
        .bind(principalId)
        .first<UserNavigationPreferenceRow>();
      return row ? parseStoredLayout(row.layout) : undefined;
    },

    async saveSidebarNavigation(principalId, layout) {
      const validated = parseSidebarNavigationLayout(layout);
      await database
        .prepare(
          `INSERT INTO user_navigation_preferences (principal_id, layout, updated_at)
           VALUES (?, ?, ?)
           ON CONFLICT(principal_id) DO UPDATE SET
             layout = excluded.layout,
             updated_at = excluded.updated_at`,
        )
        .bind(principalId, JSON.stringify(validated), new Date().toISOString())
        .run();
      const saved = await this.getSidebarNavigation(principalId);
      if (!saved)
        throw new Error("Sidebar navigation preferences were not stored");
      return saved;
    },

    async getAppearance(principalId) {
      const row = await database
        .prepare(
          `SELECT settings FROM user_appearance_preferences
           WHERE principal_id = ? LIMIT 1`,
        )
        .bind(principalId)
        .first<UserAppearancePreferenceRow>();
      if (!row) return undefined;
      try {
        return parseAppearancePreferences(JSON.parse(row.settings) as unknown);
      } catch (error) {
        if (error instanceof Error) {
          throw new Error("Stored appearance preferences are invalid", {
            cause: error,
          });
        }
        throw error;
      }
    },

    async saveAppearance(principalId, settings) {
      const validated = parseAppearancePreferences(settings);
      await database
        .prepare(
          `INSERT INTO user_appearance_preferences (principal_id, settings, updated_at)
           VALUES (?, ?, ?)
           ON CONFLICT(principal_id) DO UPDATE SET
             settings = excluded.settings,
             updated_at = excluded.updated_at`,
        )
        .bind(principalId, JSON.stringify(validated), new Date().toISOString())
        .run();
      const saved = await this.getAppearance(principalId);
      if (!saved)
        throw new Error("Appearance preferences were not stored");
      return saved;
    },
  };
}
