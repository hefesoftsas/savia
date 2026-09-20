import React from "react";
import {
  render as rtlRender,
  type RenderOptions,
} from "@testing-library/react";
import { memoryStore, StoreContextProvider } from "ra-core";
import { AppLocaleProvider } from "@/i18n/app-locale-provider";

/** Existing Studio behavior fixtures explicitly exercise the Spanish interface. */
export function render(ui: React.ReactNode, options?: RenderOptions) {
  const store = memoryStore({ locale: "es" });
  const CustomWrapper = options?.wrapper;
  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <StoreContextProvider value={store}>
        <AppLocaleProvider>
          {CustomWrapper ? <CustomWrapper>{children}</CustomWrapper> : children}
        </AppLocaleProvider>
      </StoreContextProvider>
    );
  }
  return rtlRender(ui, { ...options, wrapper: Wrapper });
}
