// @vitest-environment jsdom
import React, { useState } from "react";
import { expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FormLabelsEditor } from "../form-labels-editor";
it("allows renaming switches and read-only fields without changing their contract", () => {
  const original: any = {
    notifications_birthday: {
      type: "Toggle",
      label: "notifications · birthday",
      config: { width: 1 },
    },
    display_name: { type: "Textbox", label: "displayName", readOnly: true },
  };
  let saved = original;
  function Editor() {
    const [fields, setFields] = useState(original);
    return (
      <FormLabelsEditor
        fields={fields}
        onChange={(next) => {
          saved = next;
          setFields(next);
        }}
      />
    );
  }
  render(<Editor />);
  fireEvent.change(
    screen.getByLabelText("Etiqueta de notifications_birthday"),
    { target: { value: "Notificar cumpleaños" } },
  );
  expect(saved.notifications_birthday).toEqual({
    ...original.notifications_birthday,
    label: "Notificar cumpleaños",
  });
  fireEvent.change(screen.getByLabelText("Etiqueta de display_name"), {
    target: { value: "Nombre completo" },
  });
  expect(saved.display_name.readOnly).toBe(true);
});
