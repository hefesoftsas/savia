import { useEffect, useRef, useState } from "react";
import { useMessages } from "@/i18n/core";
import { animationCatalogMessages } from "./animation-catalog-messages";
type Animation = {
  totalFrames: number;
  addEventListener(name: string, listener: () => void): void;
  goToAndStop(frame: number, isFrame: boolean): void;
  play(): void;
  pause(): void;
  destroy(): void;
};
type Player = {
  loadAnimation(options: {
    container: HTMLElement;
    renderer: "svg";
    loop: boolean;
    autoplay: boolean;
    animationData: unknown;
  }): Animation;
};
let loading: Promise<Player> | undefined;
function loadPlayer(): Promise<Player> {
  const player = (window as Window & { lottie?: Player }).lottie;
  if (player) return Promise.resolve(player);
  if (!loading)
    loading = new Promise<Player>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "/login/lottie-light.min.js";
      script.async = true;
      const timer = setTimeout(() => fail(), 10000);
      function fail() {
        clearTimeout(timer);
        script.remove();
        loading = undefined;
        reject(new Error("Lottie player unavailable"));
      }
      script.onerror = fail;
      script.onload = () => {
        clearTimeout(timer);
        const loaded = (window as Window & { lottie?: Player }).lottie;
        if (loaded) resolve(loaded);
        else fail();
      };
      document.head.appendChild(script);
    });
  return loading;
}
export function LottiePreview({ data, name }: { data: unknown; name: string }) {
  const t = useMessages(animationCatalogMessages);
  const container = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  useEffect(() => {
    let disposed = false;
    let animation: Animation | undefined;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => {
      if (!animation) return;
      if (preference.matches)
        animation.goToAndStop(animation.totalFrames - 1, true);
      else if (document.hidden) animation.pause();
      else animation.play();
    };
    setState("loading");
    void loadPlayer()
      .then((player) => {
        if (disposed || !container.current) return;
        animation = player.loadAnimation({
          container: container.current,
          renderer: "svg",
          loop: true,
          autoplay: false,
          animationData: structuredClone(data),
        });
        animation.addEventListener("DOMLoaded", () => {
          if (!disposed) {
            setState("ready");
            sync();
          }
        });
        animation.addEventListener("data_failed", () => {
          if (!disposed) setState("error");
        });
      })
      .catch(() => {
        if (!disposed) setState("error");
      });
    document.addEventListener("visibilitychange", sync);
    preference.addEventListener("change", sync);
    return () => {
      disposed = true;
      animation?.destroy();
      document.removeEventListener("visibilitychange", sync);
      preference.removeEventListener("change", sync);
    };
  }, [data]);
  return (
    <div
      className="tenant-animation-preview"
      role="img"
      aria-label={t("Vista previa de %{name}", { name })}
    >
      <div ref={container} aria-hidden="true" />
      {state !== "ready" && (
        <span>
          {t(
            state === "error"
              ? "Vista previa no disponible."
              : "Cargando vista previa…",
          )}
        </span>
      )}
    </div>
  );
}
