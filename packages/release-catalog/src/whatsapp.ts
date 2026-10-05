// Industry-specific WhatsApp intake enters platform core only through this
// trusted release contribution, alongside the existing public-form bridge.
import { insuranceWhatsappContribution } from "@savia/insurance-quotes/whatsapp";

export const whatsappIntakeContributions = [
  insuranceWhatsappContribution,
] as const;

export {
  insuranceWhatsappContribution,
  insuranceVehicleQuoteWhatsappFlow,
  validateWhatsappVehicleQuoteIntake,
} from "@savia/insurance-quotes/whatsapp";
