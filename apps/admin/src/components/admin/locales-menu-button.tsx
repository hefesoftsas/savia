import { Check, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { Translate, useLocales, useLocaleState } from "ra-core";

function useLocaleMenuItems() {
  const languages = useLocales();
  const [locale, setLocale] = useLocaleState();

  const getNameForLocale = (languageLocale: string): string => {
    const language = languages.find((item) => item.locale === languageLocale);
    return language ? language.name : "";
  };

  return { languages, locale, setLocale, getNameForLocale };
}

export function LocalesMenuItems({
  onSelect,
  trailingSeparator = false,
}: {
  onSelect?: () => void;
  trailingSeparator?: boolean;
}) {
  const { languages, locale, setLocale, getNameForLocale } =
    useLocaleMenuItems();

  if (languages.length <= 1) {
    return null;
  }

  return (
    <>
      <DropdownMenuLabel className="flex items-center gap-1.5 px-2.5 pt-2 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
        <Globe className="size-3.5 text-muted-foreground/80" />
        <Translate i18nKey="savia.account.language">Language</Translate>
      </DropdownMenuLabel>
      <div className="space-y-0.5 px-0.5">
        {languages.map((language) => {
          const isSelected = locale === language.locale;
          return (
            <DropdownMenuItem
              key={language.locale}
              className={cn(
                "flex cursor-pointer items-center justify-between rounded-lg px-2.5 py-1.5 text-sm transition-colors",
                isSelected
                  ? "bg-primary/10 font-medium text-primary focus:bg-primary/15 focus:text-primary"
                  : "text-foreground hover:bg-accent focus:bg-accent",
              )}
              onClick={() => {
                setLocale(language.locale);
                onSelect?.();
              }}
            >
              <div className="flex items-center gap-2">
                <span className="flex size-5 items-center justify-center rounded bg-muted/80 text-[10px] font-bold text-muted-foreground uppercase">
                  {language.locale.slice(0, 2)}
                </span>
                <span>{getNameForLocale(language.locale)}</span>
              </div>
              <Check
                className={cn(
                  "size-4 shrink-0 text-primary",
                  !isSelected && "hidden",
                )}
              />
            </DropdownMenuItem>
          );
        })}
      </div>
      {trailingSeparator ? <DropdownMenuSeparator className="my-1" /> : null}
    </>
  );
}

/**
 * Language switcher button that displays a menu allowing users to select the interface language.
 *
 * Automatically renders in the header when multiple locales are configured in the i18nProvider.
 * User's language selection is persisted using the store.
 * Returns null if only one language is available.
 *
 * @see {@link https://marmelab.com/shadcn-admin-kit/docs/localesmenubutton LocalesMenuButton documentation}
 * @see {@link https://marmelab.com/ra-core/translationsetup/ i18nProvider setup}
 */
export function LocalesMenuButton() {
  const { languages, locale, setLocale, getNameForLocale } =
    useLocaleMenuItems();

  if (languages.length <= 1) {
    return null;
  }
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="hidden sm:inline-flex">
          {locale.toUpperCase()}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {languages.map((language) => (
          <DropdownMenuItem
            key={language.locale}
            onClick={() => setLocale(language.locale)}
          >
            {getNameForLocale(language.locale)}
            <Check
              className={cn("ml-auto", locale !== language.locale && "hidden")}
            />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
