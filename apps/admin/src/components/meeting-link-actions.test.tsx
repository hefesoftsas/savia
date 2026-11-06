import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MeetingLinkActions } from "./meeting-link-actions";

const meetingUrl = "https://meet.example.test/room/42";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("compact meeting link actions", () => {
  it("copies the link and keeps icon buttons named for assistive technology", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    render(<MeetingLinkActions url={meetingUrl} compact />);

    const copyButton = screen.getByRole("button", {
      name: "Copy meeting link",
    });
    expect(copyButton).toHaveAttribute("aria-label", "Copy meeting link");
    expect(copyButton).toHaveAttribute("title", "Copy meeting link");

    fireEvent.click(copyButton);

    expect(await screen.findByRole("status")).toHaveTextContent("Link copied.");
    expect(writeText).toHaveBeenCalledWith(meetingUrl);
  });

  it("shares the participant URL and reports success", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { share });

    render(<MeetingLinkActions url={meetingUrl} compact />);
    fireEvent.click(screen.getByRole("button", { name: "Share meeting link" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Link shared.");
    expect(share).toHaveBeenCalledWith({ url: meetingUrl });
  });

  it("keeps the manual-copy recovery field when compact copy fails", async () => {
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });

    render(<MeetingLinkActions url={meetingUrl} compact />);
    fireEvent.click(screen.getByRole("button", { name: "Copy meeting link" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Select the link and copy it manually.",
    );
    expect(screen.getByRole("textbox", { name: "Meeting link" })).toHaveValue(
      meetingUrl,
    );
  });

  it("does not show an error when compact sharing is cancelled", async () => {
    const share = vi
      .fn()
      .mockRejectedValue(new DOMException("cancelled", "AbortError"));
    vi.stubGlobal("navigator", { share });

    render(<MeetingLinkActions url={meetingUrl} compact />);
    const shareButton = screen.getByRole("button", {
      name: "Share meeting link",
    });
    fireEvent.click(shareButton);

    await waitFor(() => expect(shareButton).toBeEnabled());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
