import {
  colorThemeLabel,
  colorThemeSwatches,
  colorThemes,
  type ColorTheme,
} from "@/color-theme";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { useTranslate } from "ra-core";
import { useTheme } from "@/components/admin/use-theme";

export function ColorThemeToggle() {
  const { colorTheme, setColorTheme } = useTheme();
  const { isMobile } = useSidebar();
  const translate = useTranslate();
  const colorThemeName = colorThemeLabel(colorTheme);

  return (
    <SidebarMenuItem>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuButton
            aria-label={translate("savia.appearance.changePalette", {
              name: colorThemeName,
            })}
            className="h-9"
            tooltip={translate("savia.appearance.paletteCurrent", {
              name: colorThemeName,
            })}
          >
            <PalettePreview theme={colorTheme} />
            <span className="group-data-[collapsible=icon]:hidden">
              {translate("savia.appearance.palette")}
            </span>
            <span className="ml-auto text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
              {colorThemeName}
            </span>
            <span className="sr-only">
              {translate("savia.appearance.paletteCurrentShort", {
                name: colorThemeName,
              })}
            </span>
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side={isMobile ? "top" : "right"}
          align={isMobile ? "start" : "end"}
          sideOffset={4}
          className="w-60 p-2"
        >
          <DropdownMenuLabel className="px-2 py-1.5 text-sm font-medium">
            {translate("savia.appearance.choosePalette")}
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup
            className="grid max-h-64 grid-cols-4 gap-1.5 overflow-y-auto p-1"
            value={colorTheme}
            onValueChange={(value) => setColorTheme(value as ColorTheme)}
          >
            {colorThemes.map((option) => (
              <DropdownMenuRadioItem
                key={option.id}
                value={option.id}
                aria-label={option.label}
                className="size-10 justify-center rounded-md p-0 pl-0 data-[state=checked]:bg-accent data-[state=checked]:ring-1 data-[state=checked]:ring-ring [&>span:first-child]:left-1/2 [&>span:first-child]:-translate-x-1/2"
              >
                <PalettePreview theme={option.id} />
                <span className="sr-only">{option.label}</span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
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
