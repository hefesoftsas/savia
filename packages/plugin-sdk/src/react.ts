import {
  createElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
} from "react";
import { createRoot } from "react-dom/client";
import type {
  PluginApi,
  PluginCollection,
  PluginCollectionListOptions,
  PluginRecordPage,
} from "./index";
import { definePlugin } from "./index";
import { PluginLocaleProvider } from "@savia/studio-shared/plugin-locale-react";

export type PluginReactProps = { savia: PluginApi };

/** Mount a React component as a plugin entry and reusable panel renderer. */
export function defineReactPlugin(Component: ComponentType<PluginReactProps>) {
  const mount = (element: HTMLElement, savia: PluginApi): (() => void) => {
    const root = createRoot(element);
    root.render(
      createElement(PluginLocaleProvider, {
        locale: savia.i18n?.locale ?? "es",
        children: createElement(Component, { savia }),
      }),
    );
    return () => root.unmount();
  };

  return definePlugin({ render: mount, renderPanel: mount });
}

export type PluginResourceState<T> = {
  data: T | null;
  loading: boolean;
  error: unknown;
  refresh(): Promise<void>;
};

/** Read a collection page; call refresh after mutations to reload it. */
export function useCollection<T>(
  savia: PluginApi,
  collectionName: string,
  options: PluginCollectionListOptions = {},
): PluginResourceState<PluginRecordPage<T>> {
  const collection = useMemo(
    () => savia.collections.collection<T>(collectionName),
    [savia, collectionName],
  );
  const optionsKey = JSON.stringify(options);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const loader = useCallback(
    () => collection.list(optionsRef.current),
    [collection],
  );
  return usePluginResource(loader, optionsKey);
}

/** Read one record, or pass null while there is no selected record. */
export function useRecord<T>(
  savia: PluginApi,
  collectionName: string,
  id: string | null | undefined,
): PluginResourceState<T> {
  const collection = useMemo(
    () => savia.collections.collection<T>(collectionName),
    [savia, collectionName],
  );
  const loader = useCallback(
    () => (id ? collection.get(id) : Promise.resolve(null)),
    [collection, id],
  );
  return usePluginResource(loader, id ?? "");
}

function usePluginResource<T>(
  load: () => Promise<T | null>,
  dependencyKey: string,
): PluginResourceState<T> {
  const requestNumber = useRef(0);
  const [resource, setResource] = useState<{
    load: typeof load;
    dependencyKey: string;
    data: T | null;
    loading: boolean;
    error: unknown;
  } | null>(null);

  const refresh = useCallback(async () => {
    const currentRequest = ++requestNumber.current;
    setResource({
      load,
      dependencyKey,
      data: null,
      loading: true,
      error: null,
    });
    try {
      const result = await load();
      if (currentRequest === requestNumber.current)
        setResource({
          load,
          dependencyKey,
          data: result,
          loading: false,
          error: null,
        });
    } catch (caught) {
      if (currentRequest === requestNumber.current)
        setResource({
          load,
          dependencyKey,
          data: null,
          loading: false,
          error: caught,
        });
    }
  }, [load, dependencyKey]);

  useEffect(() => {
    void refresh();
    return () => {
      requestNumber.current += 1;
    };
  }, [refresh]);

  const isCurrent =
    resource?.load === load && resource.dependencyKey === dependencyKey;
  return {
    data: isCurrent ? resource.data : null,
    loading: !isCurrent || resource.loading,
    error: isCurrent ? resource.error : null,
    refresh,
  };
}
