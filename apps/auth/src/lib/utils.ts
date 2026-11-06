import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// Flatten conditional inputs before resolving Tailwind utility conflicts.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
