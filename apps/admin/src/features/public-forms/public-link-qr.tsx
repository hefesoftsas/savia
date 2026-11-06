import { useRef, useState } from "react";
import QRCode from "react-qr-code";
import { Button } from "@/components/ui/button";
import { useMessages } from "@/i18n/core";
import { publicFormsMessages } from "@/i18n/locales/public-forms";

type Props = {
  url: string;
  fileBase: string;
};

function downloadBlob(blob: Blob, fileName: string) {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoke asynchronously so the download can start first.
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

function serializeSvg(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", "512");
  clone.setAttribute("height", "512");
  return new XMLSerializer().serializeToString(clone);
}

/** QR code for a published public-form URL with SVG/PNG download. */
export function PublicLinkQr({ url, fileBase }: Props) {
  const t = useMessages(publicFormsMessages);
  const svgWrapperRef = useRef<HTMLDivElement>(null);
  const [downloadError, setDownloadError] = useState("");

  function currentSvg(): SVGSVGElement | null {
    return svgWrapperRef.current?.querySelector("svg") ?? null;
  }

  function downloadSvg() {
    try {
      const svg = currentSvg();
      if (!svg) throw new Error("missing svg");
      const markup = serializeSvg(svg);
      downloadBlob(
        new Blob([markup], { type: "image/svg+xml;charset=utf-8" }),
        `${fileBase}-qr.svg`,
      );
      setDownloadError("");
    } catch {
      setDownloadError(
        "No se pudo descargar el código QR. Inténtalo de nuevo.",
      );
    }
  }

  async function downloadPng() {
    try {
      const svg = currentSvg();
      if (!svg) throw new Error("missing svg");
      const markup = serializeSvg(svg);
      const svgBlob = new Blob([markup], {
        type: "image/svg+xml;charset=utf-8",
      });
      const svgUrl = URL.createObjectURL(svgBlob);
      try {
        const image = new Image();
        image.decoding = "sync";
        await new Promise<void>((resolve, reject) => {
          image.onload = () => resolve();
          image.onerror = () => reject(new Error("qr png encode failed"));
          image.src = svgUrl;
        });
        const canvas = document.createElement("canvas");
        canvas.width = 512;
        canvas.height = 512;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("missing 2d context");
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, "image/png"),
        );
        if (!blob) throw new Error("qr png encode failed");
        downloadBlob(blob, `${fileBase}-qr.png`);
        setDownloadError("");
      } finally {
        setTimeout(() => URL.revokeObjectURL(svgUrl), 1000);
      }
    } catch {
      setDownloadError(
        "No se pudo descargar el código QR. Inténtalo de nuevo.",
      );
    }
  }

  return (
    <div className="public-link-qr">
      <div
        ref={svgWrapperRef}
        className="public-link-qr-code"
        role="img"
        aria-label={t("Código QR del enlace público")}
        title={url}
      >
        <QRCode
          value={url}
          size={160}
          bgColor="#ffffff"
          fgColor="#000000"
          level="M"
        />
      </div>
      <div className="public-link-actions">
        <Button
          type="button"
          variant="outline"
          onClick={downloadSvg}
          aria-label={t("Descargar QR en SVG")}
        >
          {t("Descargar QR en SVG")}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => void downloadPng()}
          aria-label={t("Descargar QR en PNG")}
        >
          {t("Descargar QR en PNG")}
        </Button>
      </div>
      {downloadError && (
        <p role="alert" className="public-form-error">
          {Object.hasOwn(publicFormsMessages, downloadError)
            ? t(downloadError as keyof typeof publicFormsMessages)
            : downloadError}
        </p>
      )}
    </div>
  );
}
