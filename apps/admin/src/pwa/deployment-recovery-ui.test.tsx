import {
  render,
  screen,
  fireEvent,
  cleanup,
  act,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  DeploymentBoundary,
  DeploymentUpdateNotice,
} from "./deployment-recovery-ui";
import { registerPwaServiceWorker } from "./register-service-worker";
import { reloadApplication } from "./deployment-recovery";
vi.mock("./register-service-worker", () => ({
  registerPwaServiceWorker: vi.fn(),
}));
vi.mock("./deployment-recovery", () => ({
  isModuleLoadError: (error: Error) =>
    error.message.includes("dynamically imported module"),
  reloadApplication: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});
it("offers explicit recovery for a failed lazy module and retains retry on failed update", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(reloadApplication).mockRejectedValue(
    new Error("Necesitas conexión"),
  );
  const Broken = (): never => {
    throw new TypeError("Failed to fetch dynamically imported module: old.js");
  };
  render(
    <DeploymentBoundary>
      <Broken />
    </DeploymentBoundary>,
  );
  expect(
    screen.getByRole("heading", { name: "Actualiza la aplicación" }),
  ).toBeInTheDocument();
  expect(reloadApplication).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Actualizar y recargar" }),
  );
  await screen.findByText("Necesitas conexión");
  expect(
    screen.getByRole("button", { name: "Actualizar y recargar" }),
  ).toBeEnabled();
});
it("announces a replacement worker without reloading or discarding an open app", () => {
  const worker = Object.assign(new EventTarget(), { controller: {} });
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: worker,
  });
  render(
    <>
      <DeploymentUpdateNotice />
      <form>
        <input aria-label="Draft" defaultValue="Unsaved" />
      </form>
    </>,
  );
  worker.controller = {};
  act(() => worker.dispatchEvent(new Event("controllerchange")));
  expect(
    screen.getByText("Hay una nueva versión disponible."),
  ).toBeInTheDocument();
  expect(screen.getByLabelText("Draft")).toHaveValue("Unsaved");
  expect(reloadApplication).not.toHaveBeenCalled();
});
it("shows a spinner while the update is being installed", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(reloadApplication).mockImplementation(() => new Promise(() => {}));
  const Broken = (): never => {
    throw new TypeError("Failed to fetch dynamically imported module: old.js");
  };
  render(
    <DeploymentBoundary>
      <Broken />
    </DeploymentBoundary>,
  );
  const button = screen.getByRole("button", { name: "Actualizar y recargar" });
  fireEvent.click(button);
  expect(
    await screen.findByText("Buscando la nueva versión…"),
  ).toBeInTheDocument();
  expect(screen.getByTestId("pwa-spinner")).toBeInTheDocument();
  expect(button).toBeDisabled();
  expect(button).toHaveAttribute("aria-busy", "true");
});

function controlledWorker(controller: object | null = {}) {
  const worker = Object.assign(new EventTarget(), { controller });
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: worker,
  });
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  return worker;
}
function replaceController(worker: ReturnType<typeof controlledWorker>) {
  worker.controller = {};
  act(() => worker.dispatchEvent(new Event("controllerchange")));
}
it("automatically reloads a clean view once after a replacement takes control", () => {
  const worker = controlledWorker();
  const reload = vi.fn();
  render(<DeploymentUpdateNotice reload={reload} />);
  replaceController(worker);
  replaceController(worker);
  expect(reload).toHaveBeenCalledOnce();
  expect(reloadApplication).not.toHaveBeenCalled();
});
it("does not reload on the first worker claim or a duplicate controller event", () => {
  const worker = controlledWorker(null);
  const reload = vi.fn();
  render(<DeploymentUpdateNotice reload={reload} />);
  replaceController(worker);
  act(() => worker.dispatchEvent(new Event("controllerchange")));
  expect(reload).not.toHaveBeenCalled();
});
it.each(["form", "textarea", "iframe"])(
  "defers for an open %s and applies after it is closed",
  async (tag) => {
    const worker = controlledWorker();
    const reload = vi.fn();
    const editor = document.createElement(tag);
    document.body.append(editor);
    render(<DeploymentUpdateNotice reload={reload} />);
    replaceController(worker);
    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toBeInTheDocument();
    editor.remove();
    await act(async () => {});
    expect(reload).toHaveBeenCalledOnce();
  },
);
it("preserves edited controls outside forms until they leave the view", async () => {
  const worker = controlledWorker();
  const reload = vi.fn();
  const view = render(
    <>
      <DeploymentUpdateNotice reload={reload} />
      <input aria-label="Draft" />
    </>,
  );
  fireEvent.input(screen.getByLabelText("Draft"), {
    target: { value: "Keep me" },
  });
  replaceController(worker);
  expect(reload).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Draft")).toHaveValue("Keep me");
  view.rerender(<DeploymentUpdateNotice reload={reload} />);
  await act(async () => {});
  expect(reload).toHaveBeenCalledOnce();
});
it("waits for a visible online view without scheduling any retries", () => {
  vi.useFakeTimers();
  try {
    const worker = controlledWorker();
    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("hidden");
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const reload = vi.fn();
    render(<DeploymentUpdateNotice reload={reload} />);
    replaceController(worker);
    act(() => vi.advanceTimersByTime(600_000));
    expect(reload).not.toHaveBeenCalled();
    visibility.mockReturnValue("visible");
    fireEvent(document, new Event("visibilitychange"));
    expect(reload).not.toHaveBeenCalled();
    online.mockReturnValue(true);
    fireEvent(window, new Event("online"));
    expect(reload).toHaveBeenCalledOnce();
  } finally {
    vi.useRealTimers();
  }
});
it("honors existing beforeunload protection and retries on the next user event", () => {
  const worker = controlledWorker();
  const reload = vi.fn();
  const guard = (event: Event) => event.preventDefault();
  window.addEventListener("beforeunload", guard);
  try {
    render(<DeploymentUpdateNotice reload={reload} />);
    replaceController(worker);
    expect(reload).not.toHaveBeenCalled();
  } finally {
    window.removeEventListener("beforeunload", guard);
  }
  fireEvent(document, new Event("visibilitychange"));
  expect(reload).toHaveBeenCalledOnce();
});

it("observes a replacement even when activation happens during registration", () => {
  const worker = controlledWorker();
  const reload = vi.fn();
  vi.mocked(registerPwaServiceWorker).mockImplementationOnce(() => {
    worker.controller = {};
    worker.dispatchEvent(new Event("controllerchange"));
  });
  render(<DeploymentUpdateNotice reload={reload} />);
  expect(reload).toHaveBeenCalledOnce();
});
it("removes its listeners when the private application unmounts", () => {
  const worker = controlledWorker();
  const reload = vi.fn();
  const view = render(<DeploymentUpdateNotice reload={reload} />);
  view.unmount();
  replaceController(worker);
  fireEvent(document, new Event("visibilitychange"));
  expect(reload).not.toHaveBeenCalled();
});

it("does not let a hidden pristine editor block a safe view", () => {
  const worker = controlledWorker();
  const reload = vi.fn();
  render(
    <>
      <DeploymentUpdateNotice reload={reload} />
      <div style={{ display: "none" }}>
        <form>
          <textarea />
        </form>
      </div>
    </>,
  );
  replaceController(worker);
  expect(reload).toHaveBeenCalledOnce();
});
