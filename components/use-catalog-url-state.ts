"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import {
  buildCatalogHref,
  hasCatalogUrlState,
  parseCatalogUrlState,
  serializeCatalogUrlState,
  type CatalogUrlState,
} from "@/lib/catalog-url-state";
import type { CatalogFilters } from "@/lib/types";

/** Filters changed continuously (typing, dragging the price slider). */
type ContinuousField = "query" | "maxPrice";

/** Pause after typing or dragging before the address is updated. */
const CONTINUOUS_INPUT_DELAY = 500;
/** Clicks in quick succession (several brands) still make one history entry. */
const DISCRETE_CHANGE_DELAY = 150;

interface CommittedState extends CatalogUrlState {
  /** Continuous field that produced this history entry, if any. */
  continuousField: ContinuousField | null;
}

/** The only filter that changed, when it is a continuous one. */
function continuousChange(from: CatalogUrlState, to: CatalogUrlState): ContinuousField | null {
  if (from.page !== to.page) return null;
  const changed = (Object.keys(to.filters) as Array<keyof CatalogFilters>).filter(
    (key) => JSON.stringify(from.filters[key]) !== JSON.stringify(to.filters[key]),
  );
  return changed.length === 1 && (changed[0] === "query" || changed[0] === "maxPrice")
    ? changed[0]
    : null;
}

interface CatalogUrlStateOptions {
  filters: CatalogFilters;
  page: number;
  /** Defaults of this page (category set by /shiny or /diski). */
  defaultFilters: CatalogFilters;
  ratingSortEnabled: boolean;
  /** Applies a state read from the address (page load, Back / Forward). */
  onRestore: (state: CatalogUrlState) => void;
}

/**
 * Keeps the catalog filters, sorting, search and page in the query string
 * (UX-04), so a filtered catalog can be shared, reloaded and reached again
 * with Back / Forward.
 *
 * - On load the state is read from the address before the first paint of the
 *   client render (the server renders the default catalog; the page itself
 *   never reads search parameters, so it stays statically cached).
 * - Each user action becomes one history entry; typing in the search or
 *   dragging the price slider updates the address after a pause and keeps
 *   refining the same entry (replace) instead of adding one per keystroke or
 *   slider step.
 * - Back / Forward between entries of this page restore their state.
 *
 * The native History API is used instead of router.push/replace, as the
 * Next.js docs suggest for updating the address without a navigation: Next.js
 * patches pushState/replaceState and keeps its router state (usePathname,
 * useSearchParams, router.refresh) in sync, while no route transition runs —
 * nothing is requested from the server however the page is rendered.
 */
export function useCatalogUrlState({
  filters,
  page,
  defaultFilters,
  ratingSortEnabled,
  onRestore,
}: CatalogUrlStateOptions) {
  const onRestoreReference = useRef(onRestore);
  const committedReference = useRef<CommittedState | null>(null);
  const pendingWriteReference = useRef<number | undefined>(undefined);

  useEffect(() => {
    onRestoreReference.current = onRestore;
  });

  useLayoutEffect(() => {
    const pathname = window.location.pathname;

    function restore() {
      window.clearTimeout(pendingWriteReference.current);
      const state = parseCatalogUrlState(window.location.search, defaultFilters, {
        ratingSortEnabled,
      });
      committedReference.current = { ...state, continuousField: null };
      onRestoreReference.current(state);
    }

    if (hasCatalogUrlState(window.location.search)) {
      restore();
    } else {
      committedReference.current = { filters: defaultFilters, page: 1, continuousField: null };
    }

    function handlePopState() {
      // Another page is being restored: Next.js replaces this one.
      if (window.location.pathname !== pathname) return;
      // Only the hash changed (skip link, "#services"): nothing to restore,
      // and a change still waiting to be written must not be lost.
      const committed = committedReference.current;
      const parsed = parseCatalogUrlState(window.location.search, defaultFilters, {
        ratingSortEnabled,
      });
      if (
        committed &&
        serializeCatalogUrlState(parsed, defaultFilters).toString() ===
          serializeCatalogUrlState(committed, defaultFilters).toString()
      ) {
        return;
      }
      restore();
    }
    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
      window.clearTimeout(pendingWriteReference.current);
    };
  }, [defaultFilters, ratingSortEnabled]);

  useEffect(() => {
    const committed = committedReference.current;
    if (!committed) return;
    const next: CatalogUrlState = { filters, page };
    const nextParameters = serializeCatalogUrlState(next, defaultFilters);
    if (nextParameters.toString() === serializeCatalogUrlState(committed, defaultFilters).toString()) {
      return;
    }
    const continuousField = continuousChange(committed, next);
    pendingWriteReference.current = window.setTimeout(
      () => {
        const href = buildCatalogHref(window.location, nextParameters);
        // `null` state: Next.js adds its own router state to the entry.
        if (continuousField !== null && committed.continuousField === continuousField) {
          window.history.replaceState(null, "", href);
        } else {
          window.history.pushState(null, "", href);
        }
        committedReference.current = { ...next, continuousField };
      },
      continuousField ? CONTINUOUS_INPUT_DELAY : DISCRETE_CHANGE_DELAY,
    );
    return () => window.clearTimeout(pendingWriteReference.current);
  }, [defaultFilters, filters, page]);
}
