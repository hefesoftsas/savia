import GoogleDrive from "@thesvg/react/google-drive";
import MicrosoftOnedrive from "@thesvg/react/microsoft-onedrive";

export type OfficeStorageProvider =
  "savia" | "google_drive" | "onedrive_personal" | "onedrive_business";

export function providerName(provider: OfficeStorageProvider): string {
  return {
    savia: "Savia",
    google_drive: "Google Drive",
    onedrive_personal: "OneDrive personal",
    onedrive_business: "OneDrive work or school",
  }[provider];
}

/** Decorative brand marks always accompany a visible provider name. */
export function StorageProviderIcon({
  provider,
  className = "size-4",
}: {
  provider: OfficeStorageProvider;
  className?: string;
}) {
  const Icon = provider === "google_drive" ? GoogleDrive : MicrosoftOnedrive;
  return provider === "savia" ? (
    <img
      src="/savia-icon-192-v3.png"
      alt=""
      aria-hidden="true"
      className={`shrink-0 object-contain ${className}`}
    />
  ) : (
    <Icon
      aria-hidden="true"
      focusable="false"
      className={`shrink-0 ${className}`}
    />
  );
}
