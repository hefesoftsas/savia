import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { I18nContextProvider } from "ra-core";
import { i18nProvider } from "@/lib/i18nProvider";
import { CookieConsentBanner } from "./cookie-consent-banner";
import {
  COOKIE_CONSENT_STORAGE_KEY,
  getCookieConsent,
} from "./cookie-consent-storage";

function renderBanner() {
  return render(
    <I18nContextProvider value={i18nProvider}>
      <CookieConsentBanner />
    </I18nContextProvider>,
  );
}

describe("CookieConsentBanner", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("shows the banner when no consent decision exists", () => {
    renderBanner();

    expect(
      screen.getByRole("region", { name: /cookies/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Aceptar todas/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Solo esenciales/i }),
    ).toBeInTheDocument();
  });

  it("records acceptance and never shows the banner again", () => {
    const { unmount } = renderBanner();

    fireEvent.click(screen.getByRole("button", { name: /Aceptar todas/i }));
    expect(screen.queryByRole("region")).not.toBeInTheDocument();

    const stored = getCookieConsent();
    expect(stored?.optional).toEqual({ analytics: true, marketing: true });
    expect(stored?.decidedAt).toBeTruthy();

    unmount();
    renderBanner();
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });

  it("records rejection of non-essential cookies", () => {
    renderBanner();

    fireEvent.click(screen.getByRole("button", { name: /Solo esenciales/i }));

    expect(getCookieConsent()?.optional).toEqual({
      analytics: false,
      marketing: false,
    });
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });

  it("saves custom preferences from the preferences dialog", () => {
    renderBanner();

    fireEvent.click(screen.getByRole("button", { name: /Preferencias/i }));
    fireEvent.click(screen.getByLabelText(/analíticas/i));
    fireEvent.click(
      screen.getByRole("button", { name: /Guardar preferencias/i }),
    );

    expect(getCookieConsent()?.optional).toEqual({
      analytics: true,
      marketing: false,
    });
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });

  it("renders nothing when a valid consent is already stored", () => {
    localStorage.setItem(
      COOKIE_CONSENT_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        decidedAt: new Date().toISOString(),
        optional: { analytics: false, marketing: true },
      }),
    );

    const { container } = renderBanner();

    expect(container).toBeEmptyDOMElement();
  });

  it("shows the banner again when stored consent has a stale version", () => {
    localStorage.setItem(
      COOKIE_CONSENT_STORAGE_KEY,
      JSON.stringify({
        version: 0,
        decidedAt: new Date().toISOString(),
        optional: { analytics: true, marketing: true },
      }),
    );

    renderBanner();

    expect(
      screen.getByRole("region", { name: /cookies/i }),
    ).toBeInTheDocument();
  });
});
