// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { render } from "./locale-test-render";
import { CreateOfficeAttachment } from "../create-office-attachment";
import { createBlankOfficeFile } from "../../office/new-office-file";
vi.mock("../../office/new-office-file", () => ({
  createBlankOfficeFile: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("creates the selected presentation and only shows editing after attachment persistence", async () => {
  const file = new File(["blank"], "Resumen.pptx");
  vi.mocked(createBlankOfficeFile).mockResolvedValue(file);
  const save = vi.fn().mockResolvedValue({ id: "saved-file" });
  render(<CreateOfficeAttachment onCreate={save} />);
  fireEvent.click(screen.getByRole("button", { name: "Crear archivo" }));
  fireEvent.change(screen.getByLabelText("Tipo de archivo"), {
    target: { value: "pptx" },
  });
  fireEvent.change(screen.getByLabelText("Nombre del archivo"), {
    target: { value: "Resumen" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Crear y adjuntar" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith(file));
  expect(createBlankOfficeFile).toHaveBeenCalledWith("pptx", "Resumen");
  expect(
    await screen.findByText("Archivo guardado en los adjuntos."),
  ).toBeVisible();
  expect(save).toHaveBeenCalledTimes(1);
  expect(
    screen.queryByRole("button", { name: "Crear y adjuntar" }),
  ).not.toBeInTheDocument();
});
it("keeps the name and reports upload failures without claiming success", async () => {
  vi.mocked(createBlankOfficeFile).mockResolvedValue(
    new File(["blank"], "Documento.docx"),
  );
  render(
    <CreateOfficeAttachment
      onCreate={async () => {
        throw new Error("No permission");
      }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Crear archivo" }));
  fireEvent.click(screen.getByRole("button", { name: "Crear y adjuntar" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("No permission");
  expect(
    screen.queryByText("Archivo guardado en los adjuntos."),
  ).not.toBeInTheDocument();
  expect(screen.getByLabelText("Nombre del archivo")).toHaveValue("Documento");
});
it("does not offer formats excluded by attachment policy", () => {
  render(
    <CreateOfficeAttachment formats={["xlsx"]} onCreate={async () => {}} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Crear archivo" }));
  expect(screen.getAllByRole("option")).toHaveLength(1);
  expect(screen.getByRole("option")).toHaveValue("xlsx");
});
