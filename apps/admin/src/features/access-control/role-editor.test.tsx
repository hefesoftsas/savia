import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { expect, it, vi, afterEach } from "vitest";
import { RoleEditor } from "./role-editor";
afterEach(cleanup);
it("keeps the draft after a revision conflict", async () => {
  render(
    <RoleEditor
      scope="tenant:101"
      revision={1}
      catalog={[]}
      onSave={vi
        .fn()
        .mockRejectedValue(
          new Error("Permissions changed; reload before saving"),
        )}
    />,
  );
  fireEvent.change(screen.getByLabelText("Role name"), {
    target: { value: "claims" },
  });
  fireEvent.change(screen.getByLabelText("Display name"), {
    target: { value: "Claims reviewer" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save role" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("changed");
  expect(screen.getByLabelText("Display name")).toHaveValue("Claims reviewer");
});
it("does not save an incomplete OR condition as unrestricted access", async () => {
  const onSave = vi.fn();
  const catalog = [
    {
      resource: "collection:clients",
      label: "Clients",
      fields: ["name"],
      actions: ["read" as const],
      creatorSupported: true,
      fieldTypes: { name: "Textbox" },
      restricted: false,
    },
  ];
  render(
    <RoleEditor
      scope="tenant:101"
      revision={1}
      catalog={catalog}
      onSave={onSave}
    />,
  );
  fireEvent.change(screen.getByLabelText("Role name"), {
    target: { value: "reader" },
  });
  fireEvent.change(screen.getByLabelText("Display name"), {
    target: { value: "Reader" },
  });
  fireEvent.click(screen.getByLabelText("Read"));
  fireEvent.change(screen.getByLabelText("Record scope"), {
    target: { value: "or" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save role" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Complete every record condition",
  );
  expect(onSave).not.toHaveBeenCalled();
});

it.each(["Percentage", "Rating", "Currency"])(
  "sends numeric permission literals for %s",
  async (fieldType) => {
    const { GrantEditor } = await import("./grant-editor");
    const change = vi.fn();
    render(
      <GrantEditor
        entry={{
          resource: "collection:reviews",
          label: "Reviews",
          fields: ["score"],
          fieldTypes: { score: fieldType },
          actions: ["read"],
          creatorSupported: false,
          restricted: false,
        }}
        grants={[
          {
            resource: "collection:reviews",
            action: "read",
            fields: ["score"],
            predicate: { field: "score", op: "gte", value: { literal: 3 } },
          },
        ]}
        onChange={change}
      />,
    );
    fireEvent.change(screen.getByLabelText("Condition value"), {
      target: { value: "4" },
    });
    expect(change).toHaveBeenCalledWith([
      expect.objectContaining({
        predicate: { field: "score", op: "gte", value: { literal: 4 } },
      }),
    ]);
  },
);

it("submits a new role from the header action and normalizes its identifier", async () => {
  const onSave = vi.fn().mockResolvedValue({ id: "new-role" });
  render(
    <>
      <button type="submit" form="access-role-editor">
        Save from header
      </button>
      <RoleEditor scope="tenant:0" revision={1} catalog={[]} onSave={onSave} />
    </>,
  );
  fireEvent.change(screen.getByLabelText("Role name"), {
    target: { value: "Test" },
  });
  fireEvent.change(screen.getByLabelText("Display name"), {
    target: { value: "Test" },
  });
  expect(screen.getByLabelText("Role name")).toHaveValue("test");
  fireEvent.click(screen.getByRole("button", { name: "Save from header" }));
  expect(onSave).toHaveBeenCalledWith(
    expect.objectContaining({ name: "test", label: "Test" }),
    undefined,
  );
});

it("preserves an unsaved draft and warns when a remote revision arrives", () => {
  const onSave = vi.fn();
  const { rerender } = render(
    <RoleEditor scope="tenant:3" revision={1} catalog={[]} onSave={onSave} />,
  );
  fireEvent.change(screen.getByLabelText("Display name"), {
    target: { value: "Unsaved changes" },
  });
  rerender(
    <RoleEditor scope="tenant:3" revision={2} catalog={[]} onSave={onSave} />,
  );
  expect(screen.getByLabelText("Display name")).toHaveValue("Unsaved changes");
  expect(screen.getByRole("status")).toHaveTextContent(
    "Permissions changed elsewhere",
  );
  expect(onSave).not.toHaveBeenCalled();
});

it("does not recreate a role removed in another session", () => {
  const save = vi.fn();
  const { rerender } = render(
    <RoleEditor scope="tenant:3" revision={1} catalog={[]} onSave={save} />,
  );
  fireEvent.change(screen.getByLabelText("Role name"), {
    target: { value: "draft" },
  });
  rerender(
    <RoleEditor
      scope="tenant:3"
      revision={2}
      catalog={[]}
      onSave={save}
      unavailable
    />,
  );
  expect(screen.getByLabelText("Role name")).toHaveValue("draft");
  expect(screen.getByRole("button", { name: "Save role" })).toBeDisabled();
  expect(screen.getByRole("alert")).toHaveTextContent("removed");
  expect(save).not.toHaveBeenCalled();
});
