import { lazy, Suspense, type ComponentProps } from "react";
// Type-only: a value import here would defeat the lazy() split below.
import type { DetailPanel as DetailPanelImpl } from "./media-detail/DetailPanel";

export { useDetailPanel } from "./media-detail/useDetailPanel";

// The detail panel pulls in the whole `media-detail/` tree — seasons, cast,
// providers, recommendations, watch history, the rating and check-in modals — but
// none of it renders until the user clicks an item. Six pages (dashboard, search,
// lists, history, calendar, the command palette) import it, two of them eagerly,
// so keeping it in the entry chunk cost every first load the price of a surface
// most visits never open.
//
// Suspense is local rather than borrowed from the router boundary in App.tsx: the
// command palette renders outside `<Routes>`, so there is no ancestor boundary
// there to catch the suspend.
const LazyDetailPanel = lazy(() =>
  import("./media-detail/DetailPanel").then((m) => ({ default: m.DetailPanel }))
);

export function DetailPanel(props: ComponentProps<typeof DetailPanelImpl>) {
  return (
    <Suspense fallback={null}>
      <LazyDetailPanel {...props} />
    </Suspense>
  );
}
