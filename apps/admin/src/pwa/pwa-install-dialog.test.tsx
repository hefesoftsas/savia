import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { I18nContextProvider } from "ra-core";
import { i18nProvider } from "@/lib/i18nProvider";
import { PwaInstallDialog } from "./pwa-install-dialog";

describe("PwaInstallDialog", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders when open and displays iOS install instructions", () => {
    const handleOpenChange = vi.fn();

    render(
      <I18nContextProvider value={i18nProvider}>
        <PwaInstallDialog open={true} onOpenChange={handleOpenChange} platform="ios" />
      </I18nContextProvider>,
    );

    expect(
      screen.getByText(/Instalar Savia en tu dispositivo/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Pulsa el botón de Compartir/i),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(/Añadir a pantalla de inicio/i).length,
    ).toBeGreaterThan(0);

    const gotItButton = screen.getByRole("button", { name: /Entendido/i });
    expect(gotItButton).toBeInTheDocument();

    fireEvent.click(gotItButton);
    expect(handleOpenChange).toHaveBeenCalledWith(false);
  });

  it("displays macOS Safari instructions", () => {
    render(
      <I18nContextProvider value={i18nProvider}>
        <PwaInstallDialog open={true} onOpenChange={vi.fn()} platform="mac-safari" />
      </I18nContextProvider>,
    );

    expect(screen.getByText(/Abre el menú Archivo/i)).toBeInTheDocument();
    expect(screen.getByText(/Añadir al Dock…/i)).toBeInTheDocument();
  });

  it("displays Chromium/Desktop instructions", () => {
    render(
      <I18nContextProvider value={i18nProvider}>
        <PwaInstallDialog open={true} onOpenChange={vi.fn()} platform="chromium" />
      </I18nContextProvider>,
    );

    expect(screen.getByText(/Icono en la barra de direcciones/i)).toBeInTheDocument();
  });

  it("does not render content when open is false", () => {
    const handleOpenChange = vi.fn();

    render(
      <I18nContextProvider value={i18nProvider}>
        <PwaInstallDialog open={false} onOpenChange={handleOpenChange} />
      </I18nContextProvider>,
    );

    expect(
      screen.queryByText(/Instalar Savia en tu dispositivo/i),
    ).not.toBeInTheDocument();
  });
});
