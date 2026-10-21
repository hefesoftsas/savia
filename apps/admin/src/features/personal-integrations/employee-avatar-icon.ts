import type { ElementType } from "react";
import {
  BarChart3,
  Bot,
  Briefcase,
  Calculator,
  FileText,
  Headset,
  Shield,
  Sparkles,
  UserCheck,
} from "lucide-react";

export const AVATAR_ICONS: Record<string, ElementType> = {
  briefcase: Briefcase,
  headset: Headset,
  shield: Shield,
  "bar-chart-3": BarChart3,
  sparkles: Sparkles,
  bot: Bot,
  "file-text": FileText,
  calculator: Calculator,
  "user-check": UserCheck,
};

export function getEmployeeAvatarIcon(iconName?: string | null): ElementType {
  if (!iconName) return Bot;
  return AVATAR_ICONS[iconName.toLowerCase()] ?? Bot;
}
