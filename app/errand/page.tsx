"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

export default function ErrandPage() {
  const router = useRouter();

  return (
    <main className="min-h-screen p-6 bg-white">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-2xl font-semibold">Errand Dashboard</h1>
        <p className="mt-2 text-sm opacity-70">
          This is a pilot stub page. Next step: create errand request + pricing + assignment.
        </p>

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={() => router.push("/passenger")}
            className="rounded-xl border border-black/10 hover:bg-black/5 px-5 py-2 font-semibold"
          >
            Back to Passenger Dashboard
          </button>
        </div>
      </div>
    </main>
  );
}
