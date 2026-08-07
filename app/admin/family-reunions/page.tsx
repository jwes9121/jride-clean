"use client";

import * as React from "react";
import Link from "next/link";

type FamilySummary = {
  id: string;
  name: string;
  description: string | null;
  peopleCount: number;
};

type FamiliesResponse = {
  success: boolean;
  error?: string;
  families?: FamilySummary[];
};

export default function FamilyReunionsAdminPage() {
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [families, setFamilies] = React.useState<FamilySummary[]>([]);

  React.useEffect(() => {
    let cancelled = false;

    async function loadFamilies() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch("/api/family-reunions", {
          method: "GET",
          cache: "no-store",
        });

        const data = (await response.json()) as FamiliesResponse;

        if (cancelled) return;

        if (!response.ok || !data.success) {
          setError(data.error || "Failed to load family reunions.");
          setFamilies([]);
          return;
        }

        setFamilies(data.families || []);
      } catch (loadError) {
        if (cancelled) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Failed to load family reunions."
        );
        setFamilies([]);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadFamilies();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-white">
      <div className="mx-auto max-w-5xl">
        <p className="text-xs font-black uppercase tracking-[0.25em] text-amber-300">
          JRide Events
        </p>

        <h1 className="mt-3 text-3xl font-black">Family Reunions</h1>

        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
          Persistent genealogy projects for family reunions. These records are
          independent of any single event and can later be linked to reunion
          attendance, Event Passes, check-ins, and origin reporting.
        </p>

        {loading ? (
          <div className="mt-8 rounded-3xl border border-slate-800 bg-slate-900 p-6 text-sm text-slate-400">
            Loading family reunions...
          </div>
        ) : error ? (
          <div className="mt-8 rounded-3xl border border-red-800 bg-red-950/40 p-6 text-sm text-red-200">
            {error}
          </div>
        ) : families.length === 0 ? (
          <div className="mt-8 rounded-3xl border border-amber-800 bg-amber-950/30 p-6">
            <p className="font-black text-amber-200">
              No family reunion genealogy projects yet.
            </p>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              The database foundation is ready. Family creation and genealogy
              editing will be added as a separate controlled workflow.
            </p>
          </div>
        ) : (
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            {families.map((family) => (
              <Link
                key={family.id}
                href={`/admin/family-reunions/${family.id}`}
                className="rounded-3xl border border-slate-800 bg-slate-900 p-6 transition hover:border-amber-300/50"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-black text-white">
                      {family.name}
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-slate-400">
                      {family.description || "No description yet."}
                    </p>
                  </div>

                  <span className="shrink-0 rounded-full bg-amber-300/10 px-3 py-1 text-xs font-black text-amber-300">
                    {family.peopleCount} people
                  </span>
                </div>

                <p className="mt-5 text-sm font-bold text-amber-300">
                  Open family project
                </p>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
