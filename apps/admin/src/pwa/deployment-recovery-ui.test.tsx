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
import { reloadApplication } from "./deployment-recovery";
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
      <input aria-label="Draft" defaultValue="Unsaved" />
    </>,
  );
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
