import { Suspense } from "react";

import { SearchView } from "@/components/applications/SearchView";
import { Spinner } from "@/components/ui/States";

export default function ApplicationsPage() {
  // SearchView reads query params for deep links from the dashboard.
  return (
    <Suspense fallback={<Spinner />}>
      <SearchView />
    </Suspense>
  );
}
