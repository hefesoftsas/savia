import type { ComponentType } from "react";
import { insurancePortfolioExtensionManifest } from "./manifest";
import {
  InsurancePortfolioPoliciesScreen,
  type InsurancePortfolioScreenProps,
} from "./screens/policies";

export const insurancePortfolioScreens = [
  {
    id: "insurance.portfolio-dashboard.policies",
    extensionId: insurancePortfolioExtensionManifest.id,
    object: "polizas",
    view: "records",
    Screen: InsurancePortfolioPoliciesScreen,
  },
] satisfies ReadonlyArray<{
  id: string;
  extensionId: string;
  object: string;
  view: string;
  Screen: ComponentType<InsurancePortfolioScreenProps>;
}>;

export type { InsurancePortfolioScreenProps } from "./screens/policies";
export { InsurancePortfolioPoliciesScreen } from "./screens/policies";
export { insurancePortfolioWidgets } from "./widgets";
export type { InsurancePortfolioWidgetProps } from "./widgets";
