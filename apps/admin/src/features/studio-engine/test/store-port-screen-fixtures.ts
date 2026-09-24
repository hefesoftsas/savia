// These screens are bundled into tenant ZIP ports. Keep their behavior tests
// independent of the release catalog, which intentionally has no plugins.
import { screens as collectionsScreens } from "../../../../../../packages/insurance-collections/src/admin";
import { screens as renewalsScreens } from "../../../../../../packages/insurance-renewals/src/admin";
import { screens as claimsScreens } from "../../../../../../packages/insurance-claims/src/admin";
import { screens as commissionsScreens } from "../../../../../../packages/insurance-commissions/src/admin";
import { screens as endorsementsScreens } from "../../../../../../packages/insurance-endorsements/src/admin";
import { screens as opportunitiesScreens } from "../../../../../../packages/insurance-opportunities/src/admin";
import { screens as activitiesScreens } from "../../../../../../packages/insurance-activities/src/admin";
import { screens as issuanceScreens } from "../../../../../../packages/insurance-issuance/src/admin";
import { screens as documentsScreens } from "../../../../../../packages/insurance-documents/src/admin";
import { screens as serviceScreens } from "../../../../../../packages/insurance-service/src/admin";
import { screens as calendarScreens } from "../../../../../../packages/insurance-calendar/src/admin";
import { insuranceQuoteScreens } from "../../../../../../packages/insurance-quotes/src/admin";

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
