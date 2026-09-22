import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActiveTenantSelector } from "./active-tenant-selector";

afterEach(cleanup);

describe("ActiveTenantSelector", () => {
  it("persists an eligible active tenant through the API", async () => {
    const setActiveTenant = vi.fn().mockResolvedValue({
      activeTenantId: 202,
      tenants: [
        { id: 101, name: "Organización Norte" },
        { id: 202, name: "Organización Sur" },
      ],
      agencies: [],
    });
    const client = {
      activeTenant: vi.fn().mockResolvedValue({
        activeTenantId: 101,
        tenants: [
          { id: 101, name: "Organización Norte" },
          { id: 202, name: "Organización Sur" },
        ],
        agencies: [],
      }),
      setActiveTenant,
    };
    const user = userEvent.setup();

    render(<ActiveTenantSelector client={client} />);

    await user.selectOptions(
      await screen.findByLabelText("Organización activa"),
      "202",
    );

    await waitFor(() => expect(setActiveTenant).toHaveBeenCalledWith(202));
  });

  it("handles errors and retains confirmed tenant", async () => {
    const client = {
      activeTenant: vi.fn().mockResolvedValue({
        activeTenantId: 101,
        tenants: [
          { id: 101, name: "Organización Norte" },
          { id: 202, name: "Organización Sur" },
        ],
        agencies: [],
      }),
      setActiveTenant: vi.fn().mockRejectedValue(new Error("No disponible")),
    };
    const user = userEvent.setup();

    render(<ActiveTenantSelector client={client} />);
    const selector = await screen.findByLabelText("Organización activa");
    await user.selectOptions(selector, "202");

    expect(await screen.findByRole("alert")).toHaveTextContent("No disponible");
    expect(selector).toHaveValue("101");
  });
});
