// @vitest-environment jsdom
import React from "react";
import { it, expect, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { render } from "./locale-test-render";
import { FilePicker } from "../file-picker";

it("keeps accepted files and reports a rejected MIME type", () => {
  const onFilesChange = vi.fn();
  render(
    <FilePicker
      accept={["application/pdf"]}
      files={[]}
      maxFiles={2}
      maxSize={1024}
      onFilesChange={onFilesChange}
    />,
  );

  fireEvent.change(screen.getByTestId("file-picker-input"), {
    target: {
      files: [
        new File(["contract"], "contract.pdf", {
          type: "application/pdf",
        }),
        new File(["photo"], "photo.png", { type: "image/png" }),
      ],
    },
  });

  expect(onFilesChange).toHaveBeenCalledWith([
    expect.objectContaining({ name: "contract.pdf" }),
  ]);
  expect(screen.getByRole("alert").textContent).toContain("photo.png");
});

it("uses one compact, task-oriented attachment action", () => {
  render(
    <FilePicker
      accept={["application/pdf"]}
      files={[]}
      maxFiles={1}
      maxSize={1024}
      onFilesChange={vi.fn()}
    />,
  );

  expect(screen.getByRole("button", { name: "Adjuntar archivo" })).toBeTruthy();
  expect(screen.queryByLabelText("Seleccionar archivos")).toBeNull();
});

it("shows transfer progress for the file being uploaded", () => {
  const file = new File(["contract"], "contract.pdf", {
    type: "application/pdf",
  });
  render(
    <FilePicker
      accept={["application/pdf"]}
      files={[file]}
      maxFiles={1}
      maxSize={1024}
      onFilesChange={vi.fn()}
      uploadingFile={file}
    />,
  );

  const progress = screen.getByRole("progressbar", {
    name: "Carga de contract.pdf",
  });
  expect(progress.getAttribute("aria-valuetext")).toBe("Cargando archivo");
  expect(screen.getByText("Cargando archivo…")).toBeTruthy();
});
