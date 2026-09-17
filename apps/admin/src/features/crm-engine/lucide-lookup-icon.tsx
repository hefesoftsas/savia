import { useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";

const lucideIconLoaders = import.meta.glob<{ default: LucideIcon }>([
  "@lucide-icon-dist/*.mjs",
  "!@lucide-icon-dist/index.mjs",
]);

const loaderByIconId = new Map<
  string,
  () => Promise<{ default: LucideIcon }>
>();

for (const [path, loader] of Object.entries(lucideIconLoaders)) {
  const match = path.match(/\/([^/]+)\.mjs$/);
  if (!match) continue;
  loaderByIconId.set(match[1], loader);
}

const componentCache = new Map<string, LucideIcon>();

async function loadLucideIconComponent(name: string) {
  const cached = componentCache.get(name);
  if (cached) return cached;

  const loader = loaderByIconId.get(name);
  if (!loader) return null;

  const module = await loader();
  componentCache.set(name, module.default);
  return module.default;
}

export function LucideLookupIcon({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  const [Icon, setIcon] = useState<LucideIcon | null>(
    () => componentCache.get(name) ?? null,
  );

  useEffect(() => {
    let active = true;
    loadLucideIconComponent(name)
      .then((component) => {
        if (active) setIcon(() => component);
      })
      .catch(() => {
        if (active) setIcon(null);
      });
    return () => {
      active = false;
    };
  }, [name]);

  if (!Icon) {
    return <span className={className} aria-hidden="true" />;
  }

  return <Icon aria-hidden="true" className={className} />;
}

export function hasLucideIconLoader(name: string) {
  return loaderByIconId.has(name);
}

export const lucideIconLoaderCount = loaderByIconId.size;
