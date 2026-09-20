import { registerLocale, type ICoreLocaleStrings } from "@form-eng/core";
import type { AppLocale } from "./app-locale";
import { translateMessage } from "./core";
import { formEngineMessages } from "./locales/form-engine";

/** The form-engine registry is process-wide; the app exposes one active UI locale. */
export function configureFormEngineLocale(locale: AppLocale) {
  const t = (
    key: keyof typeof formEngineMessages,
    params?: Record<string, string | number>,
  ) => translateMessage(formEngineMessages, key, locale, params);
  const messages: ICoreLocaleStrings = {
    autoSavePending: t("autoSavePending"),
    savePending: t("savePending"),
    saving: t("saving"),
    saveError: t("saveError"),
    save: t("save"),
    cancel: t("cancel"),
    create: t("create"),
    update: t("update"),
    confirm: t("confirm"),
    add: t("add"),
    edit: t("edit"),
    deleteLabel: t("deleteLabel"),
    remove: t("remove"),
    close: t("close"),
    clear: t("clear"),
    required: t("required"),
    remaining: t("remaining"),
    na: t("na"),
    unknown: t("unknown"),
    loading: t("loading"),
    noResultsFound: t("noResultsFound"),
    clickToClear: t("clickToClear"),
    linkTitleLabel: t("linkTitleLabel"),
    linkUrlLabel: t("linkUrlLabel"),
    urlRequired: t("urlRequired"),
    seeLess: t("seeLess"),
    expand: t("expand"),
    openExpandedTextEditor: t("openExpandedTextEditor"),
    closeExpandedTextEditor: t("closeExpandedTextEditor"),
    unsavedChanges: t("unsavedChanges"),
    returnToEditing: t("returnToEditing"),
    dontSave: t("dontSave"),
    overview: t("overview"),
    by: t("by"),
    filterFields: t("filterFields"),
    saved: t("saved"),
    saveFailed: t("saveFailed"),
    validating: t("validating"),
    formWizard: t("formWizard"),
    invalidUrl: t("invalidUrl"),
    invalidEmail: t("invalidEmail"),
    invalidPhoneNumber: t("invalidPhoneNumber"),
    invalidYear: t("invalidYear"),
    noSpecialCharacters: t("noSpecialCharacters"),
    invalidCurrencyFormat: t("invalidCurrencyFormat"),
    mustBeANumber: t("mustBeANumber"),
    thisFieldIsRequired: t("thisFieldIsRequired"),
    saveRetrying: t("saveRetrying"),
    saveTimeout: t("saveTimeout"),
    draftRecovered: t("draftRecovered"),
    discardDraft: t("discardDraft"),
    unsavedChangesWarning: t("unsavedChangesWarning"),
    stepOf: (current: number, total: number) => t("stepOf", { current, total }),
    itemOfTotal: (index: number, total: number, label: string) =>
      t("itemOfTotal", { index, total, label }),
    saveChangesTo: (title: string) => t("saveChangesTo", { title }),
    contentExceedsMaxSize: (maxKb: number) =>
      t("contentExceedsMaxSize", { maxKb }),
    duplicateValue: (value: string) => t("duplicateValue", { value }),
    mustBeAtLeastChars: (min: number) => t("mustBeAtLeastChars", { min }),
    mustBeAtMostChars: (max: number) => t("mustBeAtMostChars", { max }),
    mustBeBetween: (min: number, max: number) =>
      t("mustBeBetween", { min, max }),
  };
  registerLocale(messages);
}
