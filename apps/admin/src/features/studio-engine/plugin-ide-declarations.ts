/** Ambient globals supplied by the IDE's self-contained React bundle. */
export const pluginIdeDeclarations = `
declare namespace JSX { interface IntrinsicElements { [element: string]: any; } }
declare const React: {
  createElement: any;
  Fragment: any;
  useState<T>(initial: T | (() => T)): [T, (value: T | ((current: T) => T)) => void];
  useEffect(effect: () => void | (() => void), dependencies?: readonly unknown[]): void;
  useMemo<T>(factory: () => T, dependencies: readonly unknown[]): T;
  useCallback<T extends Function>(callback: T, dependencies: readonly unknown[]): T;
  useRef<T>(initial: T): { current: T };
};
declare function createRoot(element: Element): { render(node: any): void; unmount(): void };
`;
