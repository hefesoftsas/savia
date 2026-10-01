import "@testing-library/jest-dom/vitest";
// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Workbench } from "../src/workbench";
import type { PluginApi } from "@savia/studio-shared/plugin-api";
afterEach(cleanup);
const config = {
  title: "Accounts",
  description: "Accounts",
  singular: "Account",
  object: "accounts",
  createLabel: "New account",
  defaults: { name: "" },
  fields: [{ key: "name", label: "Reference", required: true }],
  columns: [],
  metrics: () => [],
  matches: () => true,
  validate: () => null,
  exportHeaders: [],
  exportRow: () => [],
  filters: [],
  stages: [],
} as never;
function api(panel: boolean) {
  const collection = {
    list: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    get: vi.fn().mockResolvedValue({ id: "r1", name: "Invoice", _version: 3 }),
    describe: vi
      .fn()
      .mockResolvedValue({ name: "accounts", config: { fields: {} } }),
    create: vi.fn().mockResolvedValue({ id: "new" }),
    update: vi.fn().mockResolvedValue({}),
  };
  const ui = {
    panel: panel
      ? {
          panelId: "p1",
          request: {
            view: "record-editor",
            title: "Account",
            params: { recordId: "r1" },
          },
        }
      : null,
    openPanel: vi.fn().mockResolvedValue({ status: "cancelled" }),
    setPanelState: vi.fn(),
    requestClose: vi.fn(),
    completePanel: vi.fn(),
  };
  return {
    collection,
    ui,
    savia: {
      collections: { collection: () => collection },
      ui,
    } as unknown as PluginApi,
  };
}
it("opens a host panel from the list without a local dialog", async () => {
  const a = api(false);
  render(<Workbench savia={a.savia} config={config} />);
  const b = await screen.findByRole("button", { name: "New account" });
  await waitFor(() => expect(b).toBeEnabled());
  fireEvent.click(b);
  expect(a.ui.openPanel).toHaveBeenCalledWith({
    view: "record-editor",
    title: "Account",
    params: {},
  });
  expect(screen.queryByRole("dialog")).toBeNull();
});
it("renders only the editor and saves with the loaded record version", async () => {
  const a = api(true);
  render(<Workbench savia={a.savia} config={config} />);
  const input = await screen.findByLabelText(/Reference/);
  expect(input).toHaveValue("Invoice");
  expect(a.collection.list).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: "Updated" } });
  fireEvent.click(
    screen.getByRole("button", { name: /Guardar cambios|Save changes/ }),
  );
  await waitFor(() =>
    expect(a.collection.update).toHaveBeenCalledWith(
      "r1",
      { name: "Updated" },
      { version: 3 },
    ),
  );
  expect(a.ui.completePanel).toHaveBeenCalledWith({ status: "saved" });
});
it("keeps dirty input after a rejected save and allows retry", async () => {
  const a = api(true);
  a.collection.update.mockRejectedValueOnce(new Error("Version conflict"));
  render(<Workbench savia={a.savia} config={config} />);
  const input = await screen.findByLabelText(/Reference/);
  const save = screen.getByRole("button", {
    name: /Guardar cambios|Save changes/,
  });
  await waitFor(() => expect(save).toBeEnabled());
  fireEvent.change(input, { target: { value: "Retry me" } });
  fireEvent.click(save);
  await screen.findByText(/Version conflict/);
  expect(input).toHaveValue("Retry me");
  expect(a.ui.completePanel).not.toHaveBeenCalled();
  expect(a.ui.setPanelState).toHaveBeenLastCalledWith({
    dirty: true,
    busy: false,
  });
  fireEvent.click(save);
  await waitFor(() =>
    expect(a.ui.completePanel).toHaveBeenCalledWith({ status: "saved" }),
  );
});
it("uses inline editing when the host capability is absent", async () => {
  const a = api(false);
  delete a.savia.ui;
  render(<Workbench savia={a.savia} config={config} />);
  const create = await screen.findByRole("button", { name: "New account" });
  await waitFor(() => expect(create).toBeEnabled());
  fireEvent.click(create);
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(a.ui.openPanel).not.toHaveBeenCalled();
});
it.each(["saved", "cancelled"])(
  "refreshes the mounted list only for a %s result",
  async (status) => {
    const a = api(false);
    a.ui.openPanel.mockResolvedValue({ status });
    render(<Workbench savia={a.savia} config={config} />);
    const create = await screen.findByRole("button", { name: "New account" });
    await waitFor(() => expect(create).toBeEnabled());
    fireEvent.click(create);
    await waitFor(() => expect(create).toBeEnabled());
    expect(a.collection.list).toHaveBeenCalledTimes(status === "saved" ? 2 : 1);
  },
);
it("focuses the first field and treats a date-only payment change as dirty", async () => {
  const a = api(true);
  const paymentConfig = {
    ...(config as object),
    payment: { balance: () => 100, patch: () => ({ paid: 1 }) },
  } as never;
  render(<Workbench savia={a.savia} config={paymentConfig} />);
  const input = await screen.findByLabelText(/Reference/);
  await waitFor(() => expect(input).toHaveFocus());
  fireEvent.click(
    screen.getByRole("button", { name: /Registrar abono|Record payment/ }),
  );
  fireEvent.change(screen.getByLabelText(/Fecha del pago|Payment date/), {
    target: { value: "2030-01-01" },
  });
  expect(a.ui.setPanelState).toHaveBeenLastCalledWith({
    dirty: true,
    busy: false,
  });
});
it("validates required fields before writes and saves on input Enter inside the sandbox", async () => {
  const a = api(true);
  render(<Workbench savia={a.savia} config={config} />);
  const input = await screen.findByLabelText(/Reference/);
  const save = screen.getByRole("button", {
    name: /Guardar cambios|Save changes/,
  });
  await waitFor(() => expect(save).toBeEnabled());
  fireEvent.change(input, { target: { value: "" } });
  fireEvent.click(save);
  expect(a.collection.update).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: "Keyboard save" } });
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() =>
    expect(a.collection.update).toHaveBeenCalledWith(
      "r1",
      { name: "Keyboard save" },
      { version: 3 },
    ),
  );
});
it("reports attachment uploads as busy until the operation settles", async () => {
  const a = api(true);
  let finish!: (value: unknown) => void;
  const upload = vi.fn(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  a.savia.files = {
    list: vi.fn().mockResolvedValue([]),
    upload,
    remove: vi.fn(),
    download: vi.fn(),
  } as never;
  render(<Workbench savia={a.savia} config={config} />);
  const file = await screen.findByLabelText(/Adjuntar archivo|Attach file/);
  await waitFor(() => expect(file).toBeEnabled());
  fireEvent.change(file, {
    target: {
      files: [new File(["sample"], "sample.txt", { type: "text/plain" })],
    },
  });
  await waitFor(() =>
    expect(a.ui.setPanelState).toHaveBeenLastCalledWith({
      dirty: false,
      busy: true,
    }),
  );
  expect(
    screen.getByRole("button", { name: /Cancelar|Cancel/ }),
  ).toBeDisabled();
  finish({ id: "file-1" });
  await waitFor(() =>
    expect(a.ui.setPanelState).toHaveBeenLastCalledWith({
      dirty: false,
      busy: false,
    }),
  );
});

import { Screen as ActivitiesScreen } from "../../insurance-activities/src/admin";

import { CollectionsScreen as CollectionsScreen } from "../../insurance-collections/src/admin";

import { Screen as CommissionsScreen } from "../../insurance-commissions/src/admin";

import { Screen as ClaimsScreen } from "../../insurance-claims/src/admin";

import { Screen as ComplianceScreen } from "../../insurance-compliance/src/admin";

import { Screen as IssuanceScreen } from "../../insurance-issuance/src/admin";

import { Screen as EndorsementsScreen } from "../../insurance-endorsements/src/admin";

import { Screen as DocumentsScreen } from "../../insurance-documents/src/admin";

import { Screen as OpportunitiesScreen } from "../../insurance-opportunities/src/admin";

import { Screen as ServiceScreen } from "../../insurance-service/src/admin";

import { RenewalsScreen as RenewalsScreen } from "../../insurance-renewals/src/admin";

it.each([
  ActivitiesScreen,
  CollectionsScreen,
  CommissionsScreen,
  ClaimsScreen,
  ComplianceScreen,
  IssuanceScreen,
  EndorsementsScreen,
  DocumentsScreen,
  OpportunitiesScreen,
  ServiceScreen,
  RenewalsScreen,
])(
  "renders only the editor for each migrated plugin (%#)",
  async (PluginScreen) => {
    const a = api(true);
    a.ui.panel!.request.params = {} as never;
    const { container } = render(<PluginScreen savia={a.savia} />);
    await waitFor(() =>
      expect(container.querySelector("fieldset")).not.toBeDisabled(),
    );
    expect(container.querySelectorAll("form")).toHaveLength(1);
    expect(container.querySelectorAll(".iw-workbench")).toHaveLength(1);
    expect(container.querySelector(".iw-tools")).toBeNull();
    expect(a.collection.list).not.toHaveBeenCalled();
  },
);

it("allows drafting and cancelling while links load, but gates saving without stealing focus", async () => {
  const a = api(true);
  a.ui.panel!.request.params = {} as { recordId: string };
  let resolve!: (value: unknown) => void;
  a.collection.describe.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  render(<Workbench savia={a.savia} config={config} />);
  const input = await screen.findByLabelText(/Reference/);
  expect(input).toBeEnabled();
  expect(input).toHaveFocus();
  fireEvent.change(input, { target: { value: "Draft while loading" } });
  const save = screen.getByRole("button", {
    name: /Guardar cambios|Save changes/,
  });
  expect(save).toBeDisabled();
  expect(a.ui.setPanelState).toHaveBeenLastCalledWith({
    dirty: true,
    busy: false,
  });
  const cancel = screen.getByRole("button", { name: /Cancelar|Cancel/ });
  cancel.focus();
  resolve({ name: "accounts", config: { fields: {} } });
  await waitFor(() => expect(save).toBeEnabled());
  expect(input).toHaveValue("Draft while loading");
  expect(cancel).toHaveFocus();
  expect(a.collection.create).not.toHaveBeenCalled();
});
it("prepares the editor only after the list has loaded", async () => {
  const a = api(false);
  const preparePanel = vi.fn();
  a.savia.ui!.preparePanel = preparePanel;
  render(<Workbench savia={a.savia} config={config} />);
  await waitFor(() => expect(preparePanel).toHaveBeenCalledTimes(1));
  expect(a.collection.list).toHaveBeenCalled();
});
