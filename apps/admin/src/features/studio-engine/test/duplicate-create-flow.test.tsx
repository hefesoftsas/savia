// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import Root from "../app";
import { makeConfig } from "@savia/studio-shared/metadata";
import { api } from "../api";
import { setStudioRuntime } from "../runtime";
const state = vi.hoisted(() => ({
  object: undefined as any,
  source: { id: "source", name: "Original", email: "unique", _version: 7 },
  form: undefined as any,
}));
vi.mock("../generated/crm", () => ({
  useListObjects: () => ({ data: { data: [state.object] } }),
  getListObjectsQueryKey: () => ["objects"],
}));
vi.mock("../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api")>()),
  dataProvider: { getList: async () => ({ data: [], total: 0 }) },
  api: vi.fn(),
  studioFetch: vi.fn(),
  downloadCrm: vi.fn(),
}));
vi.mock("../records", () => ({ default: () => <div>Record list</div> }));
vi.mock("../record-detail", () => ({
  default: ({ onDuplicate }: any) => (
    <button onClick={() => onDuplicate(state.source)}>Duplicate source</button>
  ),
}));
vi.mock("../collection-record-form", () => ({
  default: (props: any) => {
    state.form = props;
    return (
      <>
        <input aria-label="Copy name" defaultValue={props.values.name} />
        <button onClick={props.onCancel}>Cancel copy</button>
        <button
          onClick={async () => props.onSaved(await props.onSave(props.values))}
        >
          Save copy
        </button>
      </>
    );
  },
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  setStudioRuntime({});
  window.history.replaceState(null, "", "/");
});
for (const mode of ["modal", "drawer", "page"] as const) {
  it(`creates an independent copy through the ${mode} create surface and cancellation does not write`, async () => {
    state.object = {
      name: "contacts",
      label: "Contacts",
      description: "",
      config: {
        ...makeConfig({
          name: { type: "Textbox", label: "Name" },
          email: { type: "Textbox", label: "Email", config: { unique: true } },
        }),
        studio: { screen: { createMode: mode } },
      },
    };
    setStudioRuntime({ businessSetupEnabled: false });
    vi.mocked(api).mockImplementation(async (path, method) =>
      path.startsWith("/records/")
        ? {
            data:
              method === "POST"
                ? { id: "fresh", name: "Original" }
                : state.source,
          }
        : { data: [] },
    );
    render(<Root search="object=contacts&view=records&record=source" />);
    fireEvent.click(await screen.findByText("Duplicate source"));
    await screen.findByLabelText("Copy name");
    expect(state.form.values).toEqual({ name: "Original" });
    expect(state.form.ephemeralDraft).toBe(true);
    expect(
      vi
        .mocked(api)
        .mock.calls.filter(
          (call) => call[0].startsWith("/records/") && call[1],
        ),
    ).toEqual([]);
    if (mode === "page") {
      expect(window.location.search).not.toContain("record=");
      fireEvent.click(screen.getByRole("button", { name: /Volver/ }));
    } else fireEvent.click(screen.getByText("Cancel copy"));
    await waitFor(() =>
      expect(screen.queryByLabelText("Copy name")).not.toBeInTheDocument(),
    );
    expect(
      vi
        .mocked(api)
        .mock.calls.filter(
          (call) => call[0].startsWith("/records/") && call[1],
        ),
    ).toEqual([]);
    if (mode === "page") {
      cleanup();
      render(<Root search="object=contacts&view=records&record=source" />);
    }
    fireEvent.click(await screen.findByText("Duplicate source"));
    fireEvent.click(await screen.findByText("Save copy"));
    await waitFor(() =>
      expect(
        vi
          .mocked(api)
          .mock.calls.some(
            (call) => call[0] === "/records/contacts" && call[1] === "POST",
          ),
      ).toBe(true),
    );
    expect(
      vi
        .mocked(api)
        .mock.calls.find(
          (call) => call[0] === "/records/contacts" && call[1] === "POST",
        )?.[2],
    ).toEqual({ name: "Original" });
    expect(vi.mocked(api).mock.calls.some((call) => call[1] === "PATCH")).toBe(
      false,
    );
    expect(state.source).toEqual({
      id: "source",
      name: "Original",
      email: "unique",
      _version: 7,
    });
  });
}
