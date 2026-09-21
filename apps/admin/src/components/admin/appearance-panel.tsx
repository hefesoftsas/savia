import { Moon, Palette, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslate } from "ra-core";
import { colorThemes, colorThemeSwatches, type ColorTheme } from "@/color-theme";
import { useTheme } from "@/components/admin/use-theme";
import { useTenantBranding } from "@/features/tenant-branding/tenant-branding-provider";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";

/** True on touch-first devices (Android/iOS) where nested dropdown submenus fail. */
function useCoarsePointer() {
  const [isCoarse, setIsCoarse] = useState(
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(pointer: coarse)").matches,
  );

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      return;
    }
    const mql = window.matchMedia("(pointer: coarse)");
    const onChange = (event: MediaQueryListEvent) => {
      setIsCoarse(event.matches);
    };
    mql.addEventListener("change", onChange);
    setIsCoarse(mql.matches);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isCoarse;
}

/** Personal appearance preferences, persisted through the existing theme provider. */
export function AppearancePanel() {
  const { branding } = useTenantBranding();
  const { theme, setTheme, colorTheme, setColorTheme } = useTheme();
  const translate = useTranslate();
  const isMobileWidth = useIsMobile();
  const isCoarsePointer = useCoarsePointer();

  // Adapt (impeccable): on phones and touch devices the nested
  // DropdownMenuSub opens off-screen and needs hover. Render the same
  // options inline with 44px touch targets instead. Desktop keeps the
  // existing submenu untouched.
  if (isMobileWidth || isCoarsePointer) {
    return (
      <>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>
          {translate("savia.appearance.title")}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={theme}
          onValueChange={(value) => {
            if (value === "light" || value === "dark") setTheme(value);
          }}
        >
          <DropdownMenuRadioItem value="light" className="min-h-11 gap-2.5 py-2.5">
            <Sun aria-hidden="true" className="size-4 text-muted-foreground" />
            {translate("savia.appearance.lightMode")}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark" className="min-h-11 gap-2.5 py-2.5">
            <Moon aria-hidden="true" className="size-4 text-muted-foreground" />
            {translate("savia.appearance.darkMode")}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        {!branding && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>
              {translate("savia.appearance.palette")}
            </DropdownMenuLabel>
            <div className="max-h-64 overflow-y-auto overscroll-contain">
              <DropdownMenuRadioGroup
                value={colorTheme}
                onValueChange={(value) => setColorTheme(value as ColorTheme)}
              >
                {colorThemes.map((option) => (
                  <DropdownMenuRadioItem
                    key={option.id}
                    value={option.id}
                    className="min-h-11 gap-2.5 py-2.5"
                  >
                    <PalettePreview theme={option.id} />
                    <span className="truncate">{option.label}</span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </div>
          </>
        )}
      </>
    );
  }

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className="gap-2.5 rounded-lg px-2.5 py-2">
        <Palette aria-hidden="true" className="size-4 text-muted-foreground" />
        {translate("savia.appearance.title")}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="max-h-[min(28rem,70vh)] w-56 overflow-y-auto">
        <DropdownMenuRadioGroup
          value={theme}
          onValueChange={(value) => {
            if (value === "light" || value === "dark") setTheme(value);
          }}
        >
          <DropdownMenuRadioItem value="light">
            {translate("savia.appearance.lightMode")}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            {translate("savia.appearance.darkMode")}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        {!branding && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>
              {translate("savia.appearance.palette")}
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={colorTheme}
              onValueChange={(value) => setColorTheme(value as ColorTheme)}
            >
              {colorThemes.map((option) => (
                <DropdownMenuRadioItem key={option.id} value={option.id}>
                  {option.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </>
        )}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function PalettePreview({ theme }: { theme: ColorTheme }) {
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center -space-x-1.5"
    >
      {colorThemeSwatches(theme).map((color) => (
        <span
          key={color}
          className="size-3 rounded-full border border-background/80"
          style={{ backgroundColor: color }}
        />
      ))}
    </span>
  );
}
