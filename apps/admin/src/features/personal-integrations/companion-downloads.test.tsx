import userEvent from "@testing-library/user-event";
import { cleanup, screen } from "@testing-library/react";
import { render } from "../studio-engine/test/locale-test-render";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CompanionDownloads,
  selectCompanionRelease,
} from "./companion-downloads";

const tag = "companion-preview-123";
const names = [
  "savia-companion-android.apk",
  "savia-companion-windows-x64.exe",
  "savia-companion-macos-arm64.dmg",
];
const release = {
  tag_name: tag,
  draft: false,
  prerelease: true,
  published_at: "2026-10-03T12:00:00Z",
  assets: names.map((name) => ({
    name,
    size: 12300000,
    state: "uploaded",
    browser_download_url: `https://github.com/hefesoftsas/savia/releases/download/${tag}/${name}`,
  })),
};
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe("Companion downloads", () => {
  it("only selects a complete published release with repository-owned asset URLs", () => {
    expect(selectCompanionRelease([{ ...release, draft: true }])).toBeNull();
    expect(
      selectCompanionRelease([{ ...release, assets: release.assets.slice(1) }]),
    ).toBeNull();
    expect(
      selectCompanionRelease([
        {
          ...release,
          assets: release.assets.map((a) => ({
            ...a,
            browser_download_url: "https://other.example/file",
          })),
        },
      ]),
    ).toBeNull();
    expect(selectCompanionRelease([release])?.tag).toBe(tag);
  });
  it("renders real download links for Android and both desktop platforms", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => [release] }),
    );
    render(<CompanionDownloads />);
    expect(
      await screen.findByRole("link", { name: /^Descargar Android/ }),
    ).toHaveAttribute("href", release.assets[0].browser_download_url);
    expect(
      screen.getByRole("link", { name: /^Descargar Windows/ }),
    ).toHaveAttribute("href", release.assets[1].browser_download_url);
    expect(
      screen.getByRole("link", { name: /^Descargar macOS/ }),
    ).toHaveAttribute("href", release.assets[2].browser_download_url);
  });
  it("does not fabricate download links before a release exists", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => [] }),
    );
    render(<CompanionDownloads />);
    expect(
      await screen.findByText(
        "Todavía no hay una versión de Companion publicada para descargar.",
      ),
    ).toBeVisible();
    expect(
      screen.queryByRole("link", { name: /Descargar/ }),
    ).not.toBeInTheDocument();
  });
  it("provides retry when release discovery fails", async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ ok: true, json: async () => [release] });
    vi.stubGlobal("fetch", request);
    render(<CompanionDownloads />);
    expect(
      await screen.findByRole("button", { name: "Reintentar" }),
    ).toBeVisible();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Reintentar" }));
    expect(
      await screen.findByRole("link", { name: /^Descargar Android/ }),
    ).toBeVisible();
  });
});
