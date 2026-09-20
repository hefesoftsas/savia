import { useWorkbenchMessages } from "@savia/insurance-workbench";
import { messages } from "./messages";
export { messages };
export function useMessages() { return useWorkbenchMessages(messages); }
