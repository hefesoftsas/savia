import { Palette } from "lucide-react";
import { useTranslate } from "ra-core";
import { colorThemes, type ColorTheme } from "@/color-theme";
import { useTenantBranding } from "@/features/tenant-branding/tenant-branding-provider";
import { useTheme } from "@/components/admin/use-theme";
import {
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";

/** Personal appearance preferences, persisted through the existing theme provider. */
export function AppearancePanel() {
  const { branding } = useTenantBranding();
  const { theme, setTheme, colorTheme, setColorTheme } = useTheme();
  const translate = useTranslate();

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
