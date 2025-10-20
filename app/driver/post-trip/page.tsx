export const dynamic = "force-dynamic";
export const revalidate = 0;

import { Suspense } from "react";
import DriverPostTripClient from "./DriverPostTripClient";

export default function Page() {
  return (
    <Suspense fallback={<main className="p-6 max-w-md mx-auto">Loading…</main>}>
      <DriverPostTripClient />
    </Suspense>
  );
}
