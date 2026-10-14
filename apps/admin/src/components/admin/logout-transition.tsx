import { createPortal } from "react-dom";
import { useMessages } from "@/i18n/core";
import {
  SAVIA_LOADING_LOGO,
  saviaLoadingCss,
} from "@savia/tenant-host/loading";
import { PwaSpinner } from "@/pwa/pwa-splash";
import "./logout-transition.css";

const messages = {
  closing: ["Cerrando sesión…", "Signing out…", "Encerrando sessão…"],
} as const;

/** Acknowledges explicit sign-out without interrupting auth cleanup or redirect. */
export function LogoutTransition() {
  const t = useMessages(messages);
  return createPortal(
    <div
      role="status"
      aria-label={t("closing")}
      className="savia-loading savia-logout-transition"
    >
      <style>{saviaLoadingCss}</style>
      <span className="savia-loading-mark">
        <PwaSpinner />
        <img src={SAVIA_LOADING_LOGO} alt="" width={64} height={64} />
      </span>
      <p>{t("closing")}</p>
    </div>,
    document.body,
  );
}
