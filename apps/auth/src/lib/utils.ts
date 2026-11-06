import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// Normalize conditional class names before resolving Tailwind utility conflicts.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
