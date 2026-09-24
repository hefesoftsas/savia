/**
 * Helper to sync horizontal table scroll buttons to the visible viewport
 * so that navigation arrows remain visible and accessible in tall tables.
 */

export function getScrollParent(node: HTMLElement | null): HTMLElement | null {
  if (typeof window === "undefined") return null;
  let current = node?.parentElement;
  while (current && current !== document.body) {
    const style = window.getComputedStyle(current);
    if (
      style.overflowY === "auto" ||
      style.overflowY === "scroll" ||
      style.overflow === "auto" ||
      style.overflow === "scroll"
    ) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

export function syncScrollButtonPosition(shell: HTMLElement | null) {
  if (!shell || typeof window === "undefined") return;
  const shellRect = shell.getBoundingClientRect();
  if (shellRect.height <= 0) return;

  const scrollContainer = getScrollParent(shell);
  const containerTop = scrollContainer
    ? scrollContainer.getBoundingClientRect().top
    : 0;
  const containerBottom = scrollContainer
    ? scrollContainer.getBoundingClientRect().bottom
    : window.innerHeight;

  const visibleTop = Math.max(shellRect.top, containerTop);
  const visibleBottom = Math.min(shellRect.bottom, containerBottom);
  const visibleHeight = visibleBottom - visibleTop;

  if (visibleHeight > 32) {
    const visibleMid = (visibleTop + visibleBottom) / 2;
    const buttonMargin = 20;
    const topInShell = visibleMid - shellRect.top;
    const clampedTop = Math.max(
      buttonMargin,
      Math.min(shellRect.height - buttonMargin, topInShell),
    );
    shell.style.setProperty(
      "--records-table-scroll-top",
      `${Math.round(clampedTop)}px`,
    );
  }
}
