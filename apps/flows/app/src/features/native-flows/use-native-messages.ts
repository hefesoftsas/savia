import { useCallback } from "react";

import { automationMessages } from "./messages";

export function useNativeMessages() {
  return useCallback(
    (key: string, params: Record<string, string | number> = {}) => {
      const messages = automationMessages as Record<string, readonly string[]>;
      const translated = messages[key]?.[1] ?? key;
      return translated.replace(/%\{([^}]+)\}/g, (token, name: string) =>
        Object.prototype.hasOwnProperty.call(params, name)
          ? String(params[name])
          : token,
      );
    },
    [],
  );
}
