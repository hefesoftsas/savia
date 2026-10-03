import { useState, type ReactNode } from "react";
import { memoryStore, StoreContextProvider } from "ra-core";
import { AppLocaleProvider } from "@/i18n/app-locale-provider";

export function AppLocaleTestWrapper({ children }: { children: ReactNode }) {
  const [store] = useState(() => memoryStore({ locale: "es" }));
  const Wrapper = appLocaleWrapperFor(store);
  return <Wrapper>{children}</Wrapper>;
}

export function appLocaleWrapperFor(store: ReturnType<typeof memoryStore>) {
  return function LocaleWrapper({ children }: { children: ReactNode }) {
    return (
      <StoreContextProvider value={store}>
        <AppLocaleProvider>{children}</AppLocaleProvider>
      </StoreContextProvider>
    );
  };
}
