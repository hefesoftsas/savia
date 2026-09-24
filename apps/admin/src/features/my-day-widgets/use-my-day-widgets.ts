import { useCallback, useEffect, useState } from "react";
import type { UserPreferencesClient } from "@/api/user-preferences-client";
import {
  defaultMyDayWidgets,
  parseMyDayWidgets,
  type MyDayWidget,
  type MyDayWidgetsLayout,
} from "@savia/studio-shared/my-day-widgets";

export function useMyDayWidgets(
  userPreferences: UserPreferencesClient | undefined,
) {
  const [layout, setLayout] = useState<MyDayWidgetsLayout | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (!userPreferences) {
      setLayout(defaultMyDayWidgets());
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    userPreferences
      .getMyDayWidgets()
      .then(
        (remote) => {
          if (!active) return;
          try {
            setLayout(parseMyDayWidgets(remote));
          } catch {
            setLayout(defaultMyDayWidgets());
            setFeedback(
              "Tus widgets guardados no se pudieron leer. Empezamos de cero.",
            );
          }
        },
        () => {
          if (!active) return;
          setLayout(defaultMyDayWidgets());
          setFeedback("No pudimos cargar tus widgets. Reintenta.");
        },
      )
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [userPreferences]);

  const persist = useCallback(
    async (next: MyDayWidgetsLayout, successMessage: string | null) => {
      if (!userPreferences) {
        setLayout(next);
        if (successMessage) setFeedback(successMessage);
        return true;
      }
      setSaving(true);
      setFeedback(null);
      try {
        const saved = await userPreferences.saveMyDayWidgets(next);
        setLayout(parseMyDayWidgets(saved));
        if (successMessage) setFeedback(successMessage);
        return true;
      } catch {
        setFeedback("No pudimos guardar tus widgets. Reintenta.");
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
        "Widget agregado a Mi día.",
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
        "Widget eliminado.",
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
    (activeId: string, overId: string) => {
      const widgets = layout?.widgets ?? [];
      const from = widgets.findIndex((widget) => widget.id === activeId);
      const to = widgets.findIndex((widget) => widget.id === overId);
      if (from < 0 || to < 0 || from === to) return Promise.resolve(false);
      const next = [...widgets];
      const [entry] = next.splice(from, 1);
      next.splice(to, 0, entry);
      return persist({ version: 1, widgets: next }, null);
    },
    [layout, persist],
  );

  const hasSystemWidget = useCallback(
    (kind: "agenda" | "quick_task") =>
      (layout?.widgets ?? []).some((widget) => widget.kind === kind),
    [layout],
  );

  return {
    layout,
    widgets: layout?.widgets ?? [],
    loading,
    saving,
    feedback,
    unavailable: !userPreferences,
    setFeedback,
    add,
    remove,
    move,
    reorder,
    hasSystemWidget,
    reload: useCallback(async () => {
      if (!userPreferences) return;
      setLoading(true);
      try {
        setLayout(parseMyDayWidgets(await userPreferences.getMyDayWidgets()));
      } catch {
        setFeedback("No pudimos cargar tus widgets. Reintenta.");
      } finally {
        setLoading(false);
      }
    }, [userPreferences]),
  };
}
