import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActiveAgencySelector } from "./active-agency-selector";

afterEach(cleanup);

describe("ActiveAgencySelector", () => {
  it("persists an eligible active agency through the API instead of browser storage", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const setActiveAgency = vi.fn().mockResolvedValue({
      activeAgencyId: 202,
      agencies: [
        { id: 101, name: "Agencia Norte" },
        { id: 202, name: "Agencia Sur" },
      ],
    });
    const client = {
      activeAgency: vi.fn().mockResolvedValue({
        activeAgencyId: 101,
        agencies: [
          { id: 101, name: "Agencia Norte" },
          { id: 202, name: "Agencia Sur" },
        ],
      }),
      setActiveAgency,
    };
    const user = userEvent.setup();

    render(<ActiveAgencySelector client={client} />);

    await user.selectOptions(
      await screen.findByLabelText("Agencia activa"),
      "202",
    );

    await waitFor(() => expect(setActiveAgency).toHaveBeenCalledWith(202));
    expect(setItem).not.toHaveBeenCalled();
  });

  it("keeps the confirmed agency and exposes a retry-safe error", async () => {
    const client = {
      activeAgency: vi.fn().mockResolvedValue({
        activeAgencyId: 101,
        agencies: [
          { id: 101, name: "Agencia Norte" },
          { id: 202, name: "Agencia Sur" },
        ],
      }),
      setActiveAgency: vi.fn().mockRejectedValue(new Error("No disponible")),
    };
    const user = userEvent.setup();

    render(<ActiveAgencySelector client={client} />);
    const selector = await screen.findByLabelText("Agencia activa");
    await user.selectOptions(selector, "202");

    expect(await screen.findByRole("alert")).toHaveTextContent("No disponible");
    expect(selector).toHaveValue("101");
  });
});
