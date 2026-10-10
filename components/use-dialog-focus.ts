"use client";

import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "summary",
  "iframe",
  "[contenteditable='true']",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/** Elements outside every dialog that stay reachable, e.g. the toast live region. */
export const DIALOG_KEEP_ACTIVE_ATTRIBUTE = "data-dialog-keep-active";

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter(
    (element) =>
      element.getClientRects().length > 0 && !element.closest("[inert]"),
  );
}

/**
 * Makes everything outside `container` inert (not focusable, not clickable,
 * hidden from assistive technology): every sibling of the container and of
 * each of its ancestors up to <body>. Returns a function that restores them.
 */
function makeOutsideInert(container: HTMLElement): () => void {
  const changedElements: HTMLElement[] = [];
  let node: HTMLElement = container;
  while (node.parentElement && node !== document.body) {
    const parent: HTMLElement = node.parentElement;
    for (const sibling of Array.from(parent.children)) {
      if (
        sibling === node ||
        !(sibling instanceof HTMLElement) ||
        sibling.inert ||
        sibling.hasAttribute(DIALOG_KEEP_ACTIVE_ATTRIBUTE) ||
        ["SCRIPT", "STYLE", "TEMPLATE", "LINK", "META", "NOSCRIPT"].includes(sibling.tagName)
      ) {
        continue;
      }
      sibling.inert = true;
      changedElements.push(sibling);
    }
    node = parent;
  }
  return () => {
    for (const element of changedElements) element.inert = false;
  };
}

/**
 * Modal dialog behaviour for a container that is rendered only while open:
 * - moves focus inside on open (`[data-autofocus]`, else the first control,
 *   else the container itself);
 * - keeps Tab / Shift+Tab inside;
 * - Escape calls `onEscape`;
 * - the rest of the page is inert while the dialog is open;
 * - focus returns to the element that was focused before opening.
 *
 * The container should hold an element with role="dialog", aria-modal and an
 * accessible name (aria-labelledby or aria-label).
 */
export function useDialogFocus(
  open: boolean,
  containerReference: RefObject<HTMLElement | null>,
  onEscape?: () => void,
) {
  const onEscapeReference = useRef(onEscape);

  useEffect(() => {
    onEscapeReference.current = onEscape;
  });

  useEffect(() => {
    if (!open) return;
    const container = containerReference.current;
    if (!container) return;

    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const restoreOutside = makeOutsideInert(container);

    const initialTarget =
      container.querySelector<HTMLElement>("[data-autofocus]") ??
      getFocusableElements(container)[0] ??
      container;
    if (initialTarget === container && !container.hasAttribute("tabindex")) {
      container.setAttribute("tabindex", "-1");
    }
    initialTarget.focus({ preventScroll: true });

    function handleKeyDown(event: KeyboardEvent) {
      if (!container) return;
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        onEscapeReference.current?.();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = getFocusableElements(container);
      if (focusable.length === 0) {
        event.preventDefault();
        container.focus({ preventScroll: true });
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      const focusIsInside = active instanceof Node && container.contains(active);

      if (event.shiftKey && (!focusIsInside || active === first || active === container)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (!focusIsInside || active === last)) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      restoreOutside();
      if (previouslyFocused?.isConnected && !previouslyFocused.closest("[inert]")) {
        previouslyFocused.focus({ preventScroll: true });
      }
    };
  }, [open, containerReference]);
}
