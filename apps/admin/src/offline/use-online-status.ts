import { useSyncExternalStore } from "react";
import {
  getOnlineStatus,
  getServerOnlineStatus,
  subscribeOnlineStatus,
} from "./connectivity-status";

/** Browser hints verified against Savia when the browser reports offline. */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(
    subscribeOnlineStatus,
    getOnlineStatus,
    getServerOnlineStatus,
  );
}
