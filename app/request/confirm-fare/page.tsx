export const dynamic = "force-dynamic";
export const revalidate = 0;

import { Suspense } from "react";
import ConfirmFareClient from "./ConfirmFareClient";

export default function Page() {
  return (
    <Suspense fallback={<main className="p-6 max-w-md mx-auto">Loading…</main>}>
      <ConfirmFareClient />
    </Suspense>
  );
}


