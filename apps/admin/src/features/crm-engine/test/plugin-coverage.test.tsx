import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { render } from "./locale-test-render";
import type { PluginApi } from "@savia/crm-shared/plugin-api";
import { releaseCatalog } from "@savia/release-catalog";
import { ValueInput } from "../workflow-editor";
afterEach(cleanup);
it("clears attachments on record switch even if the next list fails", async () => {
  const files = {
    list: vi
      .fn()
      .mockResolvedValueOnce([
        { id: "file-a", name: "A.txt", size: 10, version: 1 },
      ])
      .mockRejectedValueOnce(new Error("Denied")),
    upload: vi.fn(),
    download: vi.fn(),
    remove: vi.fn(),
  };
  const records = ["a", "b"].map((id) => ({
    id,
    name: id,
    _version: 1,
    stage: "pending",
    amount: 100,
    paid: 0,
  }));
  const collection = {
    describe: vi.fn().mockResolvedValue({ name: "accounts" }),
    list: vi.fn().mockResolvedValue({ data: records, total: records.length }),
  };
  const savia = {
    files,
    collections: { collection: () => collection },
  } as unknown as PluginApi;
  const Screen = releaseCatalog.extensionScreens.find(
    (entry) => entry.extensionId === "insurance.collections",
  )!.Screen;
  render(<Screen savia={savia} />);
  fireEvent.click(await screen.findByRole("button", { name: "Gestionar a" }));
  await screen.findByText(/A.txt/);
  fireEvent.click(screen.getByRole("button", { name: "Cerrar panel" }));
  fireEvent.click(screen.getByRole("button", { name: "Gestionar b" }));
  await screen.findByRole("alert");
  expect(screen.queryByText(/A.txt/)).toBeNull();
  expect(screen.queryByRole("button", { name: "Eliminar" })).toBeNull();
});
it("edits calendar offsets without losing their source variable", () => {
  const change = vi.fn();
  render(
    <ValueInput
      label="Fecha"
      value={{ dateOffset: { value: { ref: "trigger.expiry" }, days: -30 } }}
      onChange={change}
      variables={["trigger.expiry"]}
    />,
  );
  expect(screen.getByDisplayValue("trigger.expiry")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Días antes (negativo) o después"), {
    target: { value: "-45" },
  });
  expect(change).toHaveBeenCalledWith({
    dateOffset: { value: { ref: "trigger.expiry" }, days: -45 },
  });
});
