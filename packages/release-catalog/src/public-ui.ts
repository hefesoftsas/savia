// Industry quote UI for core public hosts (browser only).
//
// Core hosts must load industry solutions only through the release catalog,
// so the shared comparator and its stylesheet enter here — never through a
// direct industry import, and never from workers (the API consumes
// ./public-forms, which stays free of UI and styles).
import "@savia/insurance-quotes/quote-screens.css";

export { QuoteResults } from "@savia/insurance-quotes/quote-results";
export type { QuoteBatchItem } from "@savia/insurance-quotes/quote-results";
