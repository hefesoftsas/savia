import { ChevronDown, Moon, Palette, Sun } from "lucide-react";
import { useState } from "react";
import { useTranslate } from "ra-core";
import {
  colorThemes,
  colorThemeLabel,
  colorThemeSwatches,
  type ColorTheme,
} from "@/color-theme";
import { useTheme } from "@/components/admin/use-theme";
import { useTenantBranding } from "@/features/tenant-branding/tenant-branding-provider";
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";

/** Selected state for the compact option buttons (checked is still announced). */
const checkedButtonClassName =
  "data-[state=checked]:bg-accent data-[state=checked]:text-accent-foreground data-[state=checked]:ring-1 data-[state=checked]:ring-ring";
/** The default radio dot has no room in the compact buttons; ring shows state. */
const hideIndicatorClassName = "[&>span:first-child]:hidden";

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
          <div className="px-1">
            <DropdownMenuRadioGroup
              value={theme}
              onValueChange={(value) => {
                if (value === "light" || value === "dark") setTheme(value);
              }}
              className="grid grid-cols-2 gap-1"
            >
              <DropdownMenuRadioItem
                value="light"
                className={`min-h-11 justify-center gap-1.5 rounded-lg px-2 py-2 ${checkedButtonClassName} ${hideIndicatorClassName}`}
              >
                <Sun
                  aria-hidden="true"
                  className="size-4 shrink-0 text-muted-foreground"
                />
                <span className="truncate">
                  {translate("savia.appearance.lightMode")}
                </span>
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem
                value="dark"
                className={`min-h-11 justify-center gap-1.5 rounded-lg px-2 py-2 ${checkedButtonClassName} ${hideIndicatorClassName}`}
              >
                <Moon
                  aria-hidden="true"
                  className="size-4 shrink-0 text-muted-foreground"
                />
                <span className="truncate">
                  {translate("savia.appearance.darkMode")}
                </span>
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </div>
          {!branding && (
            <>
              <DropdownMenuLabel className="flex items-baseline justify-between gap-2">
                <span>{translate("savia.appearance.palette")}</span>
                <span className="truncate text-xs font-normal text-muted-foreground">
                  {colorThemeLabel(colorTheme)}
                </span>
              </DropdownMenuLabel>
              <div className="px-1 pb-1">
                <DropdownMenuRadioGroup
                  value={colorTheme}
                  onValueChange={(value) => setColorTheme(value as ColorTheme)}
                  className="grid grid-cols-4 gap-1"
                >
                  {colorThemes.map((option) => (
                    <DropdownMenuRadioItem
                      key={option.id}
                      value={option.id}
                      title={option.label}
                      aria-label={option.label}
                      className={`size-11 min-h-11 justify-center rounded-lg p-0 ${checkedButtonClassName} ${hideIndicatorClassName}`}
                    >
                      <PalettePreview theme={option.id} />
                      <span className="sr-only">{option.label}</span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </div>
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
