import { cleanup, waitFor } from "@testing-library/react";
import { render } from "./test/locale-test-render";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Root from "./app";
import { setStudioRuntime } from "./runtime";
import {
  clearStudioQueryCache,
  getStudioQueryClient,
  isStudioBootstrapped,
  setStudioQueryOwner,
  studioCacheOwner,
} from "./studio-query-cache";

const OWNER = studioCacheOwner("test-env", "user-1");

function bootstrapTransport(calls: string[]) {
  return async (path: string) => {
    calls.push(path);
    if (path.endsWith("/bootstrap")) return Response.json({});
    return Response.json({ error: "no" }, { status: 500 });
  };
}

beforeEach(() => {
  clearStudioQueryCache();
  setStudioQueryOwner(OWNER);
});

afterEach(() => {
  cleanup();
  clearStudioQueryCache();
  setStudioRuntime({ embedded: false });
  vi.restoreAllMocks();
});

describe("Studio regreso al mismo dominio", () => {
  it("reutiliza el cliente conservado y no repite /bootstrap", async () => {
    const calls: string[] = [];
    setStudioRuntime({
      embedded: true,
      domainId: "platform",
      businessSetupEnabled: false,
      transport: bootstrapTransport(calls),
    });
    const shared = getStudioQueryClient("platform", OWNER);
    shared.setQueryData(["probe"], { v: 1 });

    const first = render(<Root embedded queryClient={shared} />);
    await waitFor(() =>
      expect(calls.filter((path) => path.endsWith("/bootstrap"))).toHaveLength(
        1,
      ),
    );
    expect(isStudioBootstrapped("platform", OWNER)).toBe(true);
    first.unmount();
    // Al salir no se vacía el cliente compartido.
    expect(shared.getQueryData(["probe"])).toEqual({ v: 1 });

    render(<Root embedded queryClient={shared} />);
    // Da tiempo a un posible segundo bootstrap antes de afirmar.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(calls.filter((path) => path.endsWith("/bootstrap"))).toHaveLength(1);
    expect(shared.getQueryData(["probe"])).toEqual({ v: 1 });
  });

  it("cierra la suscripción al espacio local al salir", async () => {
    const calls: string[] = [];
    const unsubscribe = vi.fn();
    setStudioRuntime({
      embedded: true,
      domainId: "platform",
      businessSetupEnabled: false,
      transport: bootstrapTransport(calls),
      localWorkspace: {
        store: { subscribeQueryChanges: () => unsubscribe },
      } as never,
    });
    const shared = getStudioQueryClient("platform", OWNER);
    const mounted = render(<Root embedded queryClient={shared} />);
    await waitFor(() =>
      expect(calls.filter((path) => path.endsWith("/bootstrap"))).toHaveLength(
        1,
      ),
    );
    mounted.unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    // El cliente conservado sigue intacto tras cerrar suscripciones.
    expect(shared.getQueryData(["probe"])).toBeUndefined();
  });
});
