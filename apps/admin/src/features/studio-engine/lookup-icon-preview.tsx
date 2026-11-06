import { Suspense, lazy } from "react";
import { parseLookupIconRef, type LookupIcon } from "@savia/studio-shared/request-page";

const LucideLookupIcon = lazy(async () => {
  const module = await import("./lucide-lookup-icon");
  return { default: module.LucideLookupIcon };
});

const ThesvgLookupIcon = lazy(async () => {
  const module = await import("./thesvg-lookup-icon");
  return { default: module.ThesvgLookupIcon };
});

function LookupIconPreviewInner({
  icon,
  className,
}: {
  icon: LookupIcon;
  className?: string;
}) {
  const parsed = parseLookupIconRef(icon);
  if (parsed.library === "thesvg") {
    return <ThesvgLookupIcon name={parsed.id} className={className} />;
  }
  return <LucideLookupIcon name={parsed.id} className={className} />;
}

export function LookupIconPreview({
  icon,
  className,
}: {
  icon: LookupIcon;
  className?: string;
}) {
  return (
    <Suspense fallback={<span className={className} aria-hidden="true" />}>
      <LookupIconPreviewInner icon={icon} className={className} />
    </Suspense>
  );
}
