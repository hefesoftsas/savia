export type ReadScope = {
  sessionGeneration: number;
  kind: "principal" | "tenant" | "platform" | "public";
  /** Public routes must pass an opaque per-route identifier, never a share token. */
  id: string;
};

export function readKey(
  scope: ReadScope,
  resource: string,
  params?: Readonly<Record<string, unknown>>,
): readonly unknown[] {
  return [
    "savia-read",
    scope.sessionGeneration,
    scope.kind,
    scope.id,
    resource,
    params ?? {},
  ];
}
