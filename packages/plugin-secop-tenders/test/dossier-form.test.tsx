/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { DossierForm } from "../dossier-form";
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
it("submits through the plugin callback when native form submission is blocked", () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const submit = vi.fn();
  act(() =>
    root.render(
      <DossierForm onSubmit={submit}>
        <input name="name" required defaultValue="Company" />
        <button type="button" data-dossier-submit>
          Save
        </button>
      </DossierForm>,
    ),
  );
  host.querySelector("form")!.addEventListener(
    "submit",
    (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
    },
    { capture: true },
  );
  act(() => host.querySelector("button")!.click());
  expect(submit).toHaveBeenCalledOnce();
  expect(new FormData(submit.mock.calls[0][0]).get("name")).toBe("Company");
  act(() => root.unmount());
  host.remove();
});
