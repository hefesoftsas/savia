import { createContext } from "react";

export type VariableAccess = {
  read(name: string): Promise<{
    value: string;
    editable: boolean;
    note?: string;
  }>;
  write(name: string, value: string): void;
};

export const VariableAccessContext = createContext<VariableAccess>({
  read: async () => ({ value: "", editable: false }),
  write: () => undefined,
});
