/**
 * Static plan profiles shared by the embedded comparator and the anonymous
 * public projection. This module is intentionally free of React and plugin
 * runtime imports so the API worker can consume it: every string here is a
 * fixed catalog label with no quote numbers, premiums, credentials, or
 * customer data.
 */

export type UnifiedQuoteCoverage = {
  rce: string; // Responsabilidad Civil Extracontractual
  partialLossDeductible: string; // Deducible Pérdida Parcial (Daños/Hurto)
  totalLossDeductible: string; // Deducible Pérdida Total
  replacementCar: string; // Auto de Reemplazo / Sustituto
  craneAssistance: string; // Grúa y Asistencia en Viaje
  designatedDriver: string; // Conductor Elegido
  medicalExpenses: string; // Amparo Patrimonial & Gastos Médicos
  legalAssistance: string; // Asistencia Jurídica en Sitio 24/7
  workshop: string; // Red de talleres / Concesionario
};

export type ProviderPlanProfile = {
  provider: string;
  productName: string;
  baseScore: number;
  defaultPremium: number;
  badges: string[];
  coverages: UnifiedQuoteCoverage;
  highlights: string[];
  ctaText: string;
  ctaSubtext: string;
};

export const defaultProfiles: Record<string, ProviderPlanProfile> = {
  "sbs-producto-10": {
    provider: "SBS Seguros",
    productName: "Plan Gold Premium",
    baseScore: 9.6,
    defaultPremium: 1250000,
    badges: [
      "Mejor relación cobertura/precio",
      "Todo Riesgo",
      "Cero Deducible",
      "Auto Sustituto",
    ],
    coverages: {
      rce: "$4.000.000.000 COP",
      partialLossDeductible: "10% mín. 1 SMMLV",
      totalLossDeductible: "0% (Sin Deducible)",
      replacementCar: "15 días continuos",
      craneAssistance: "Ilimitada Nacional",
      designatedDriver: "12 servicios / año",
      medicalExpenses: "Hasta $60M COP",
      legalAssistance: "Abogado presencial / Ilimitada",
      workshop: "Taller concesionario oficial Chevrolet",
    },
    highlights: [
      "Responsabilidad Civil: $4.000 Millones",
      "Pérdida total al 100% comercial sin deducible",
      "Auto sustituto garantizado: 15 días",
      "Asistencia de grúa ilimitada nacional",
      "Taller concesionario oficial",
    ],
    ctaText: "Emitir Póliza Gold →",
    ctaSubtext: "Emisión 100% digital e inmediata",
  },
  "sbs-producto-8": {
    provider: "SBS Seguros",
    productName: "Autos Producto 8",
    baseScore: 9.1,
    defaultPremium: 1180000,
    badges: ["Todo Riesgo", "Auto Sustituto"],
    coverages: {
      rce: "$3.000.000.000 COP",
      partialLossDeductible: "10% mín. 1 SMMLV",
      totalLossDeductible: "10% deducible",
      replacementCar: "10 días continuos",
      craneAssistance: "Hasta 150 km / evento",
      designatedDriver: "8 servicios / año",
      medicalExpenses: "Hasta $50M COP",
      legalAssistance: "Abogado presencial / Ilimitada",
      workshop: "Red de concesionarios y multimarca",
    },
    highlights: [
      "Responsabilidad Civil: $3.000 Millones",
      "Deducible Pérdida Parcial: 10% mín 1 SMMLV",
      "Auto sustituto: 10 días continuos",
      "Asistencia de grúa hasta 150 km por evento",
      "Red de talleres autorizados",
    ],
    ctaText: "Seleccionar Producto 8",
    ctaSubtext: "Excelente cobertura balanceada",
  },
  "sbs-producto-11": {
    provider: "SBS Seguros",
    productName: "Plata Esencial",
    baseScore: 8.7,
    defaultPremium: 1080000,
    badges: ["Precio más bajo", "Económica"],
    coverages: {
      rce: "$2.000.000.000 COP",
      partialLossDeductible: "12% mín. 1.2 SMMLV",
      totalLossDeductible: "0% (Sin Deducible)",
      replacementCar: "No amparada",
      craneAssistance: "Hasta 80 km / evento",
      designatedDriver: "No incluido",
      medicalExpenses: "Hasta $25M COP",
      legalAssistance: "Telefónica 24/7",
      workshop: "Red de talleres multimarcas convenidos",
    },
    highlights: [
      "Responsabilidad Civil: $2.000 Millones",
      "Pérdida total al 100% valor comercial",
      "Sin vehículo de reemplazo",
      "Asistencia de grúa básica 80 km",
      "Red de talleres multimarcas convenidos",
    ],
    ctaText: "Seleccionar Plan Plata",
    ctaSubtext: "Ideal para presupuestos ajustados",
  },
  "sura-autos-provider": {
    provider: "SURA Seguros",
    productName: "Conduce Seguro Plus",
    baseScore: 9.3,
    defaultPremium: 1390000,
    badges: [
      "Real Preferente",
      "Emisión Inmediata",
      "Auto Sustituto",
      "Todo Riesgo",
    ],
    coverages: {
      rce: "$3.000.000.000 COP",
      partialLossDeductible: "10% mín. 1 SMMLV",
      totalLossDeductible: "10% deducible",
      replacementCar: "10 días continuos",
      craneAssistance: "Hasta 150 km por evento",
      designatedDriver: "8 servicios / año",
      medicalExpenses: "Hasta $60M COP",
      legalAssistance: "Abogado presencial / Ilimitada",
      workshop: "Centros de servicio Autos SURA VIP",
    },
    highlights: [
      "Responsabilidad Civil: $3.000 Millones",
      "Deducible Pérdida Parcial: 10% mín 1 SMMLV",
      "Auto sustituto: 10 días continuos",
      "Asistencia de grúa hasta 150 km por evento",
      "Centros de servicio Autos SURA VIP",
    ],
    ctaText: "Seleccionar Plan SURA",
    ctaSubtext: "Incluye revisión preventiva gratis",
  },
  "liberty-integral-quote": {
    provider: "Liberty Seguros",
    productName: "Plan Integral",
    baseScore: 9.4,
    defaultPremium: 1448081,
    badges: ["Todo Riesgo", "Cero Deducible", "Auto Sustituto"],
    coverages: {
      rce: "$4.000.000.000 COP",
      partialLossDeductible: "10% mín. 1 SMMLV",
      totalLossDeductible: "0% (Sin Deducible)",
      replacementCar: "15 días continuos",
      craneAssistance: "Ilimitada Nacional",
      designatedDriver: "10 servicios / año",
      medicalExpenses: "Hasta $50M COP",
      legalAssistance: "Abogado presencial / Ilimitada",
      workshop: "Red de concesionarios Liberty",
    },
    highlights: [
      "Responsabilidad Civil: $4.000 Millones",
      "Pérdida total al 100% sin deducible",
      "Auto sustituto garantizado: 15 días",
      "Asistencia grúa ilimitada nacional",
      "Talleres concesionarios de marca",
    ],
    ctaText: "Emitir Póliza Liberty Integral →",
    ctaSubtext: "Emisión directa con Liberty Seguros",
  },
  "liberty-full-quote": {
    provider: "Liberty Seguros",
    productName: "Plan Full",
    baseScore: 9.0,
    defaultPremium: 1448081,
    badges: ["Todo Riesgo", "Auto Sustituto"],
    coverages: {
      rce: "$3.000.000.000 COP",
      partialLossDeductible: "10% mín. 1 SMMLV",
      totalLossDeductible: "10% deducible",
      replacementCar: "10 días continuos",
      craneAssistance: "Hasta 150 km / evento",
      designatedDriver: "6 servicios / año",
      medicalExpenses: "Hasta $40M COP",
      legalAssistance: "Abogado presencial",
      workshop: "Red multimarca autorizada",
    },
    highlights: [
      "Responsabilidad Civil: $3.000 Millones",
      "Pérdida total con deducible preferencial",
      "Auto sustituto: 10 días",
      "Grúa hasta 150 km por evento",
      "Red multimarca autorizada",
    ],
    ctaText: "Seleccionar Liberty Full",
    ctaSubtext: "Excelente respaldo nacional",
  },
  "liberty-basico-pt-quote": {
    provider: "Liberty Seguros",
    productName: "Básico + Pérdida Total",
    baseScore: 8.5,
    defaultPremium: 1448081,
    badges: ["Económica", "Pérdida Total"],
    coverages: {
      rce: "$2.000.000.000 COP",
      partialLossDeductible: "No amparada",
      totalLossDeductible: "10% deducible",
      replacementCar: "No amparada",
      craneAssistance: "Hasta 100 km / evento",
      designatedDriver: "No incluido",
      medicalExpenses: "Hasta $30M COP",
      legalAssistance: "Telefónica 24/7",
      workshop: "Red de talleres convenidos",
    },
    highlights: [
      "Responsabilidad Civil: $2.000 Millones",
      "Amparo de pérdida total por daños y hurto",
      "Asistencia jurídica telefónica 24/7",
      "Grúa hasta 100 km por evento",
      "Sin amparo de daños parciales",
    ],
    ctaText: "Seleccionar Básico + PT",
    ctaSubtext: "Protección esencial contra siniestros mayores",
  },
  "liberty-basico-quote": {
    provider: "Liberty Seguros",
    productName: "Básico RCE",
    baseScore: 8.2,
    defaultPremium: 1448081,
    badges: ["Precio más bajo", "Económica"],
    coverages: {
      rce: "$2.000.000.000 COP",
      partialLossDeductible: "No amparada",
      totalLossDeductible: "No amparada",
      replacementCar: "No amparada",
      craneAssistance: "Hasta 80 km / evento",
      designatedDriver: "No incluido",
      medicalExpenses: "Hasta $20M COP",
      legalAssistance: "Telefónica 24/7",
      workshop: "No aplica",
    },
    highlights: [
      "Responsabilidad Civil: $2.000 Millones",
      "Amparo patrimonial por daños a terceros",
      "Asistencia jurídica telefónica 24/7",
      "Grúa básica en caso de colisión",
      "Cuota mensual mínima",
    ],
    ctaText: "Seleccionar Liberty Básico",
    ctaSubtext: "Cumplimiento normativo y RCE",
  },
  "equidad-full-quote": {
    provider: "Equidad Seguros",
    productName: "Plan Full",
    baseScore: 9.2,
    defaultPremium: 1220000,
    badges: ["Todo Riesgo", "Auto Sustituto"],
    coverages: {
      rce: "$3.000.000.000 COP",
      partialLossDeductible: "10% mín. 1 SMMLV",
      totalLossDeductible: "10% deducible",
      replacementCar: "10 días continuos",
      craneAssistance: "Hasta 120 km / evento",
      designatedDriver: "6 servicios / año",
      medicalExpenses: "Hasta $40M COP",
      legalAssistance: "Abogado presencial",
      workshop: "Red de talleres Equidad",
    },
    highlights: [
      "Responsabilidad Civil: $3.000 Millones",
      "Deducible Pérdida Parcial: 10% mín 1 SMMLV",
      "Auto sustituto: 10 días continuos",
      "Grúa hasta 120 km por evento",
      "Respaldo cooperativo solidario",
    ],
    ctaText: "Seleccionar Equidad Full",
    ctaSubtext: "Tarifa cooperativa preferencial",
  },
  "equidad-basico-quote": {
    provider: "Equidad Seguros",
    productName: "Plan Básico",
    baseScore: 8.4,
    defaultPremium: 980000,
    badges: ["Precio más bajo", "Económica"],
    coverages: {
      rce: "$2.000.000.000 COP",
      partialLossDeductible: "No amparada",
      totalLossDeductible: "10% deducible",
      replacementCar: "No amparada",
      craneAssistance: "Hasta 80 km / evento",
      designatedDriver: "No incluido",
      medicalExpenses: "Hasta $20M COP",
      legalAssistance: "Telefónica 24/7",
      workshop: "Red de talleres convenidos",
    },
    highlights: [
      "Responsabilidad Civil: $2.000 Millones",
      "Pérdida total al valor comercial",
      "Asistencia básica en carretera",
      "Sin vehículo sustituto",
      "Tarifa económica",
    ],
    ctaText: "Seleccionar Equidad Básico",
    ctaSubtext: "Costo accesible para todo vehículo",
  },
};

/**
 * Static plan highlights safe for anonymous surfaces: fixed catalog labels
 * with no quote numbers, premiums, or customer data. The public projection
 * uses them as coverage bullets when a live provider response carries no
 * coverage breakdown — mirroring what the embedded comparator shows for
 * simulated quotes.
 */
export function publicPlanHighlights(flowId: string): string[] {
  const profile = defaultProfiles[flowId];
  if (profile) return [...profile.highlights];
  return ["Póliza todo riesgo autos"];
}
