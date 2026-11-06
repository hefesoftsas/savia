import type {
  StudioObject,
  RecordSurface,
  ScreenNavigationSection,
} from "@savia/studio-shared/metadata";
import type { LookupIcon } from "@savia/studio-shared/request-page";

export function withScreen(
  object: StudioObject,
  changes: {
    hidden?: boolean;
    order?: number;
    createMode?: RecordSurface;
    editMode?: RecordSurface;
    section?: ScreenNavigationSection;
    icon?: LookupIcon;
  },
): StudioObject {
  const screen = { ...object.config.studio?.screen };
  if (changes.hidden !== undefined) screen.hidden = changes.hidden;
  if (changes.order !== undefined) screen.order = changes.order;
  if (changes.createMode !== undefined) screen.createMode = changes.createMode;
  if (changes.editMode !== undefined) screen.editMode = changes.editMode;
  if (changes.section !== undefined) screen.section = changes.section;
  if (changes.icon !== undefined) screen.icon = changes.icon;
  return {
    ...object,
    config: {
      ...object.config,
      studio: {
        ...object.config.studio,
        screen,
      },
    },
  };
}

export function sortScreens(
  objects: StudioObject[],
  locale: string = "es",
): StudioObject[] {
  return [...objects].sort((left, right) => {
    const leftOrder = left.config.studio?.screen?.order;
    const rightOrder = right.config.studio?.screen?.order;
    if (leftOrder != null || rightOrder != null) {
      if (leftOrder == null) return 1;
      if (rightOrder == null) return -1;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    }
    return left.label.localeCompare(right.label, locale);
  });
}
