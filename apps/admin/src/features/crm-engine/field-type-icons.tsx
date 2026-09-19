import {
  Type,
  Hash,
  CircleDollarSign,
  Rows3,
  ListChecks,
  Bold,
  List,
  Search,
  ToggleLeft,
  Calendar,
  Clock,
  Paperclip,
  HelpCircle,
  Mail,
  Phone,
  Globe,
  MapPinned,
  Code2,
  MapPin,
  Heading,
  type LucideIcon,
} from "lucide-react";
import {
  DISPLAY_TEXT_TYPE,
  R2_ATTACHMENT_TYPE,
} from "@savia/crm-shared/metadata";

export const fieldTypePalette: {
  type: string;
  label: string;
  icon: LucideIcon;
  searchTerms?: string;
}[] = [
  { type: "Textbox", label: "Texto", icon: Type },
  { type: "Email", label: "Correo", icon: Mail },
  { type: "Phone", label: "Teléfono", icon: Phone },
  { type: "Url", label: "Página web", icon: Globe },
  { type: "Address", label: "Dirección", icon: MapPin },
  { type: "MapLocation", label: "Ubicación en mapa", icon: MapPinned },
  { type: "FormHtml", label: "HTML personalizado", icon: Code2 },
  { type: DISPLAY_TEXT_TYPE, label: "Texto fijo", icon: Heading },
  { type: "Number", label: "Número", icon: Hash },
  {
    type: "Currency",
    label: "Moneda",
    icon: CircleDollarSign,
    searchTerms: "moneda divisa dinero precio cop usd eur plata currency valor",
  },
  { type: "Textarea", label: "Texto largo", icon: Rows3 },
  {
    type: "RichText",
    label: "Rich text",
    icon: Bold,
    searchTerms: "texto enriquecido formato markdown",
  },
  {
    type: "MultiSelect",
    label: "Multiple choice",
    icon: ListChecks,
    searchTerms: "selección múltiple etiquetas opciones",
  },
  { type: "Dropdown", label: "Selección", icon: List },
  { type: "Autocomplete", label: "Autocompletar", icon: Search },
  { type: "Toggle", label: "Sí / No", icon: ToggleLeft },
  { type: "DateControl", label: "Fecha", icon: Calendar },
  {
    type: "DateTime",
    label: "Date and time",
    icon: Calendar,
    searchTerms: "fecha hora datetime timestamp",
  },
  {
    type: "Time",
    label: "Time",
    icon: Clock,
    searchTerms: "hora horario time",
  },
  { type: R2_ATTACHMENT_TYPE, label: "Archivo adjunto", icon: Paperclip },
];

const icons = Object.fromEntries(
  fieldTypePalette.map((entry) => [entry.type, entry.icon]),
) as Record<string, LucideIcon>;

export function fieldTypeIcon(type: string): LucideIcon {
  return icons[type] ?? HelpCircle;
}

export function fieldTypeLabel(type: string) {
  return fieldTypePalette.find((entry) => entry.type === type)?.label ?? type;
}

export function normalizePaletteTypeSearch(value: string): string {
  return value.trim().toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
}

export function filterPaletteFieldTypes<
  T extends { type: string; label: string; searchTerms?: string },
>(items: T[], query: string): T[] {
  const needle = normalizePaletteTypeSearch(query);
  if (!needle) return items;
  return items.filter(({ type, label, searchTerms }) =>
    [type, label, searchTerms ?? ""].some((value) =>
      normalizePaletteTypeSearch(value).includes(needle),
    ),
  );
}

export function FieldTypeIcon({
  type,
  size = 15,
}: {
  type: string;
  size?: number;
}) {
  const Icon = fieldTypeIcon(type);
  return <Icon size={size} aria-hidden="true" />;
}
