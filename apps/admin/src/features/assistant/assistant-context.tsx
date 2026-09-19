import { createContext, useContext } from "react";
import type { PropsWithChildren } from "react";
import type { AppServices } from "@/app-services";

const AppServicesContext = createContext<AppServices | null>(null);

export function AppServicesProvider({
  services,
  children,
}: PropsWithChildren<{ services: AppServices }>) {
  return (
    <AppServicesContext.Provider value={services}>
      {children}
    </AppServicesContext.Provider>
  );
}

export function useAppServices(): AppServices {
  const services = useContext(AppServicesContext);
  if (!services) {
    throw new Error("AppServicesProvider is required for the assistant.");
  }
  return services;
}
