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
  fireEvent.click(screen.getByLabelText("read"));
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
