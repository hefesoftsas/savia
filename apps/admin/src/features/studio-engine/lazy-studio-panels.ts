import { lazy } from "react";

export const ScreenManager = lazy(() => import("./screen-manager"));
export const ScreenAdministration = lazy(
  () => import("./screen-administration"),
);
export const ScreenMenuReorder = lazy(() => import("./screen-menu-reorder"));
