import { createContext } from "react";
import type { ColorTheme } from "@/color-theme";

export type Theme = "dark" | "light" | "system";

export type ThemeProviderState = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  colorTheme: ColorTheme;
  setColorTheme: (theme: ColorTheme) => void;
};

const initialState: ThemeProviderState = {
  theme: "system",
  setTheme: () => null,
  colorTheme: "emerald",
  setColorTheme: () => null,
};

export const ThemeProviderContext =
  createContext<ThemeProviderState>(initialState);
