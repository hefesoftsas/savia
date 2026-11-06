// These screens are bundled into tenant ZIP ports. Keep their behavior tests
// independent of the release catalog, which intentionally has no plugins.
import { screens as collectionsScreens } from "@savia/insurance-collections/admin";
import { screens as renewalsScreens } from "@savia/insurance-renewals/admin";
import { screens as claimsScreens } from "@savia/insurance-claims/admin";
import { screens as commissionsScreens } from "@savia/insurance-commissions/admin";
import { screens as endorsementsScreens } from "@savia/insurance-endorsements/admin";
import { screens as opportunitiesScreens } from "@savia/insurance-opportunities/admin";
import { screens as activitiesScreens } from "@savia/insurance-activities/admin";
import { screens as issuanceScreens } from "@savia/insurance-issuance/admin";
import { screens as documentsScreens } from "@savia/insurance-documents/admin";
import { screens as serviceScreens } from "@savia/insurance-service/admin";
import { screens as calendarScreens } from "@savia/insurance-calendar/admin";
import { insuranceQuoteScreens } from "@savia/insurance-quotes/admin";

export const storePortScreens = [
  ...collectionsScreens,
  ...renewalsScreens,
  ...claimsScreens,
  ...commissionsScreens,
  ...endorsementsScreens,
  ...opportunitiesScreens,
  ...activitiesScreens,
  ...issuanceScreens,
  ...documentsScreens,
  ...serviceScreens,
  ...calendarScreens,
  ...insuranceQuoteScreens,
];

export { QuoteResults as StorePortQuoteResults } from "@savia/insurance-quotes/quote-results";
