import { afterEach, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { render } from "./locale-test-render";
import { OfficeEditButton } from "../office-edit-button";
import { setStudioRuntime } from "../runtime";
import { OfficeAvailabilityContext } from "@/features/office-settings/office-availability";
afterEach(() => {
  cleanup();
  setStudioRuntime({ embedded: false });
});
it("removes the editor link when the suite is blocked while retaining allowed links", () => {
  setStudioRuntime({
    embedded: true,
    apiBasePath: "/v1/studio/101",
    tenantId: 101,
  });
  const file = {
    id: "file-1",
    name: "Report.docx",
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    size: 100,
  };
  const { rerender } = render(
    <OfficeAvailabilityContext.Provider
      value={{ enabled: true, loading: false, error: false }}
    >
      <OfficeEditButton file={file} />
    </OfficeAvailabilityContext.Provider>,
  );
  expect(screen.getByRole("link")).toHaveAttribute(
    "href",
    "/office/?base=%2Fv1%2Fstudio%2F101&file=file-1",
  );
  rerender(
    <OfficeAvailabilityContext.Provider
      value={{ enabled: false, loading: false, error: false }}
    >
      <OfficeEditButton file={file} />
    </OfficeAvailabilityContext.Provider>,
  );
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
});
