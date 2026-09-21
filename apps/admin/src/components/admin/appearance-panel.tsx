import { ChevronDown, Moon, Palette, Sun } from "lucide-react";
import { useState } from "react";
import { useTranslate } from "ra-core";
import { colorThemes, colorThemeSwatches, type ColorTheme } from "@/color-theme";
import { useTheme } from "@/components/admin/use-theme";
import { useTenantBranding } from "@/features/tenant-branding/tenant-branding-provider";
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";

/**
 * Personal appearance preferences, persisted through the existing theme provider.
 *
 * Rendered as an inline expandable section of the account menu on every
 * platform. A nested DropdownMenuSub was replaced because its floating
 * content never became visible: off-screen on touch devices and missing on
 * desktop too. Inline content stays in the menu flow, opens with tap or
 * click (no hover needed) and scrolls with the single parent container.
 */
export function AppearancePanel() {
  const { branding } = useTenantBranding();
  const { theme, setTheme, colorTheme, setColorTheme } = useTheme();
  const translate = useTranslate();
  const [open, setOpen] = useState(false);

  return (
    <>
      <DropdownMenuItem
        aria-expanded={open}
        className="gap-2.5 rounded-lg px-2.5 py-2"
        onSelect={(event) => {
          // Keep the account menu open and expand inline instead.
          event.preventDefault();
          setOpen((value) => !value);
        }}
      >
        <Palette aria-hidden="true" className="size-4 text-muted-foreground" />
        <span className="flex-1">{translate("savia.appearance.title")}</span>
        <ChevronDown
          aria-hidden="true"
          className={`size-4 shrink-0 text-muted-foreground transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
        />
      </DropdownMenuItem>
      {open ? (
        <>
          <DropdownMenuRadioGroup
            value={theme}
            onValueChange={(value) => {
              if (value === "light" || value === "dark") setTheme(value);
            }}
          >
            <DropdownMenuRadioItem
              value="light"
              className="min-h-11 gap-2.5 py-2.5"
            >
              <Sun
                aria-hidden="true"
                className="size-4 text-muted-foreground"
              />
              {translate("savia.appearance.lightMode")}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem
              value="dark"
              className="min-h-11 gap-2.5 py-2.5"
            >
              <Moon
                aria-hidden="true"
                className="size-4 text-muted-foreground"
              />
              {translate("savia.appearance.darkMode")}
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          {!branding && (
            <>
              <DropdownMenuLabel>
                {translate("savia.appearance.palette")}
              </DropdownMenuLabel>
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
            </>
          )}
        </>
      ) : null}
    </>
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
