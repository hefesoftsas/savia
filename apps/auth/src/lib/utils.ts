import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// Resolve conflicting utility classes after flattening conditional inputs.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
