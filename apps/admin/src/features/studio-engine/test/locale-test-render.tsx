import type { AppLocale } from "@/i18n/app-locale";
import type { ReactElement, ReactNode } from "react";
import {
  render as baseRender,
  type RenderOptions,
} from "@testing-library/react";
import { StoreContextProvider, memoryStore } from "ra-core";
import { AppLocaleProvider } from "@/i18n/app-locale-provider";

/** Existing Spanish UI specifications explicitly opt into their expected locale. */
export function render(
  ui: ReactElement,
  options: RenderOptions & { locale?: AppLocale } = {},
) {
  const { locale = "es", ...renderOptions } = options;
  const store = memoryStore({ locale });
  const Outer = renderOptions.wrapper;
  function Wrapper({ children }: { children: ReactNode }) {
    const content = (
      <StoreContextProvider value={store}>
        <AppLocaleProvider>{children}</AppLocaleProvider>
      </StoreContextProvider>
    );
    return Outer ? <Outer>{content}</Outer> : content;
  }
  return baseRender(ui, { ...renderOptions, wrapper: Wrapper });
}
