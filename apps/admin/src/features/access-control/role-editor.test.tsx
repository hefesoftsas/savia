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
