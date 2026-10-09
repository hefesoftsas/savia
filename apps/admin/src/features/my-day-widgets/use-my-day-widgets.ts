import { useCallback, useEffect, useRef, useState } from "react";
import {
  translateMessage,
  useAppLocale,
  type MessageParams,
} from "@/i18n/core";
import { myDayStateMessages } from "./my-day-state-messages";
import type { UserPreferencesClient } from "@/api/user-preferences-client";
import {
  defaultMyDayWidgets,
  parseMyDayWidgets,
  type MyDayWidget,
  type MyDayWidgetsLayout,
} from "@savia/studio-shared/my-day-widgets";

let layoutCache = new WeakMap<UserPreferencesClient, MyDayWidgetsLayout>();
let layoutRevisions = new WeakMap<UserPreferencesClient, number>();
let sessionGeneration = 0;
type WidgetMessage = {
  key: keyof typeof myDayStateMessages;
  params?: MessageParams;
};
type WidgetFeedback = string | WidgetMessage | null;
const message = (
  key: WidgetMessage["key"],
  params?: MessageParams,
): WidgetMessage => ({ key, params });

function clearLayoutCache() {
  sessionGeneration += 1;
  layoutCache = new WeakMap();
  layoutRevisions = new WeakMap();
}

function nextLayoutRevision(client: UserPreferencesClient): number {
  const next = (layoutRevisions.get(client) ?? 0) + 1;
  layoutRevisions.set(client, next);
  return next;
}

if (typeof window !== "undefined") {
  window.addEventListener("savia:session-cleared", clearLayoutCache);
  window.addEventListener("savia:principal-changed", clearLayoutCache);
}

export function useMyDayWidgets(
  userPreferences: UserPreferencesClient | undefined,
) {
  const locale = useAppLocale();
  const [layoutState, setLayoutState] = useState<MyDayWidgetsLayout | null>(
    () => (userPreferences ? (layoutCache.get(userPreferences) ?? null) : null),
  );
  const [layoutOwner, setLayoutOwner] = useState(userPreferences);
  const [loadingState, setLoading] = useState(
    () => !userPreferences || !layoutCache.has(userPreferences),
  );
  const [currentSessionGeneration, setCurrentSessionGeneration] =
    useState(sessionGeneration);
  const [saving, setSaving] = useState(false);
  const [feedbackState, setFeedback] = useState<WidgetFeedback>(null);
  const revision = useRef(0);
  const layout =
    layoutOwner === userPreferences
      ? layoutState
      : userPreferences
        ? (layoutCache.get(userPreferences) ?? null)
        : null;
  const loading =
    layoutOwner === userPreferences
      ? loadingState
      : !userPreferences || !layoutCache.has(userPreferences);

  useEffect(() => {
    const clear = () => {
      revision.current += 1;
      setLayoutState(null);
      setLayoutOwner(userPreferences);
      setLoading(true);
      setFeedback(null);
      setCurrentSessionGeneration(sessionGeneration);
    };
    window.addEventListener("savia:session-cleared", clear);
    window.addEventListener("savia:principal-changed", clear);
    return () => {
      window.removeEventListener("savia:session-cleared", clear);
      window.removeEventListener("savia:principal-changed", clear);
    };
  }, [userPreferences]);

  useEffect(() => {
    if (!userPreferences) {
      setLayoutState(defaultMyDayWidgets());
      setLayoutOwner(undefined);
      setLoading(false);
      return;
    }
    let active = true;
    const generation = sessionGeneration;
    const requestRevision = nextLayoutRevision(userPreferences);
    revision.current = requestRevision;
    const existing = layoutCache.get(userPreferences);
    if (!existing) setLoading(true);
    userPreferences
      .getMyDayWidgets()
      .then(
        (remote) => {
          if (
            !active ||
            generation !== sessionGeneration ||
            revision.current !== requestRevision ||
            layoutRevisions.get(userPreferences) !== requestRevision
          )
            return;
          try {
            const next = parseMyDayWidgets(remote);
            layoutCache.set(userPreferences, next);
            setLayoutState(next);
            setLayoutOwner(userPreferences);
          } catch {
            setLayoutState(defaultMyDayWidgets());
            setLayoutOwner(userPreferences);
            setFeedback(
              message("Saved widgets could not be read. Starting over."),
            );
          }
        },
        () => {
          if (
            !active ||
            generation !== sessionGeneration ||
            revision.current !== requestRevision ||
            layoutRevisions.get(userPreferences) !== requestRevision
          )
            return;
          if (!existing) setLayoutState(defaultMyDayWidgets());
          setLayoutOwner(userPreferences);
          setFeedback(message("Could not load widgets. Try again."));
        },
      )
      .finally(() => {
        if (
          active &&
          generation === sessionGeneration &&
          revision.current === requestRevision
        ) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [userPreferences, currentSessionGeneration]);

  const persist = useCallback(
    async (
      next: MyDayWidgetsLayout,
      successMessage: WidgetMessage["key"] | null,
    ) => {
      if (!userPreferences) {
        setLayoutState(next);
        setLayoutOwner(undefined);
        if (successMessage) setFeedback(message(successMessage));
        return true;
      }
      setSaving(true);
      setFeedback(null);
      const generation = sessionGeneration;
      const saveRevision = nextLayoutRevision(userPreferences);
      revision.current = saveRevision;
      try {
        const saved = await userPreferences.saveMyDayWidgets(next);
        if (
          generation !== sessionGeneration ||
          revision.current !== saveRevision ||
          layoutRevisions.get(userPreferences) !== saveRevision
        )
          return false;
        const parsed = parseMyDayWidgets(saved);
        layoutCache.set(userPreferences, parsed);
        setLayoutState(parsed);
        setLayoutOwner(userPreferences);
        if (successMessage) setFeedback(message(successMessage));
        return true;
      } catch {
        if (
          generation === sessionGeneration &&
          revision.current === saveRevision
        ) {
          setFeedback(message("Could not save widgets. Try again."));
        }
        return false;
      } finally {
        setSaving(false);
      }
    },
    [userPreferences],
  );

  const add = useCallback(
    (widget: MyDayWidget) =>
      persist(
        {
          version: 1,
          widgets: [...(layout?.widgets ?? []), widget],
        },
        "Widget added to My Day.",
      ),
    [layout, persist],
  );

  const remove = useCallback(
    (id: string) =>
      persist(
        {
          version: 1,
          widgets: (layout?.widgets ?? []).filter((widget) => widget.id !== id),
        },
        "Widget removed.",
      ),
    [layout, persist],
  );

  const move = useCallback(
    (id: string, direction: -1 | 1) => {
      const widgets = layout?.widgets ?? [];
      const index = widgets.findIndex((widget) => widget.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= widgets.length)
        return Promise.resolve(false);
      const next = [...widgets];
      const [entry] = next.splice(index, 1);
      next.splice(target, 0, entry);
      return persist({ version: 1, widgets: next }, null);
    },
    [layout, persist],
  );

  const reorder = useCallback(
    (activeId: string, overId: string, visibleIds?: string[]) => {
      const all = layout?.widgets ?? [];
      const widgets = visibleIds
        ? all.filter((widget) => visibleIds.includes(widget.id))
        : all;
      const from = widgets.findIndex((widget) => widget.id === activeId);
      const to = widgets.findIndex((widget) => widget.id === overId);
      if (from < 0 || to < 0 || from === to) return Promise.resolve(false);
      const next = [...widgets];
      const [entry] = next.splice(from, 1);
      next.splice(to, 0, entry);
      let position = 0;
      const ordered = visibleIds
        ? all.map((widget) =>
            visibleIds.includes(widget.id) ? next[position++]! : widget,
          )
        : next;
      return persist({ version: 1, widgets: ordered }, null);
    },
    [layout, persist],
  );

  const hasSystemWidget = useCallback(
    (kind: "agenda" | "quick_task" | "mail" | "office_documents") =>
      (layout?.widgets ?? []).some((widget) => widget.kind === kind),
    [layout],
  );

  return {
    layout,
    widgets: layout?.widgets ?? [],
    loading,
    saving,
    feedback:
      typeof feedbackState === "object" && feedbackState
        ? translateMessage(
            myDayStateMessages,
            feedbackState.key,
            locale,
            feedbackState.params,
          )
        : feedbackState,
    unavailable: !userPreferences,
    setFeedback,
    add,
    remove,
    move,
    reorder,
    hasSystemWidget,
    reload: useCallback(async () => {
      if (!userPreferences) return;
      const generation = sessionGeneration;
      const requestRevision = nextLayoutRevision(userPreferences);
      revision.current = requestRevision;
      const existing = layoutCache.get(userPreferences);
      setLoading(!existing);
      try {
        const parsed = parseMyDayWidgets(
          await userPreferences.getMyDayWidgets(),
        );
        if (
          generation !== sessionGeneration ||
          revision.current !== requestRevision ||
          layoutRevisions.get(userPreferences) !== requestRevision
        )
          return;
        layoutCache.set(userPreferences, parsed);
        setLayoutState(parsed);
        setLayoutOwner(userPreferences);
      } catch {
        if (
          generation === sessionGeneration &&
          revision.current === requestRevision
        ) {
          setFeedback(message("Could not load widgets. Try again."));
        }
      } finally {
        if (
          generation === sessionGeneration &&
          revision.current === requestRevision
        ) {
          setLoading(false);
        }
      }
    }, [userPreferences]),
  };
}
