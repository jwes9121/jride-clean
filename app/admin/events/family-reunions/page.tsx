"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

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

type CreateResponse = {
  success: boolean;
  error?: string;
  family?: FamilySummary;
};

export default function FamilyReunionsAdminPage() {
  const router = useRouter();

  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [families, setFamilies] = React.useState<FamilySummary[]>([]);

  const [showCreate, setShowCreate] = React.useState(false);
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [createError, setCreateError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    async function loadFamilies() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch("/api/events/family-reunions", {
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

  async function createFamily() {
    setCreateError(null);

    if (!name.trim()) {
      setCreateError("Family reunion name is required.");
      return;
    }

    setCreating(true);

    try {
      const response = await fetch("/api/events/family-reunions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name,
          description,
        }),
      });

      const data = (await response.json()) as CreateResponse;

      if (!response.ok || !data.success || !data.family?.id) {
        setCreateError(data.error || "Failed to create family reunion.");
        return;
      }

      router.push(`/admin/events/family-reunions/${data.family.id}`);
    } catch (createFailure) {
      setCreateError(
        createFailure instanceof Error
          ? createFailure.message
          : "Failed to create family reunion."
      );
    } finally {
      setCreating(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-white">
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.25em] text-amber-300">
              JRide Events
            </p>

            <h1 className="mt-3 text-3xl font-black">Family Reunions</h1>

            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
              Persistent genealogy projects for family reunions. These records
              are independent of any single event and can later be linked to
              reunion attendance, Event Passes, check-ins, and origin
              reporting.
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              setShowCreate((current) => !current);
              setCreateError(null);
            }}
            className="rounded-xl bg-amber-400 px-4 py-3 text-sm font-black text-slate-950"
          >
            {showCreate ? "Close" : "Create Family Reunion"}
          </button>
        </div>

        {showCreate ? (
          <section className="mt-6 rounded-3xl border border-amber-300/30 bg-slate-900 p-6">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-amber-300">
              New Genealogy Project
            </p>
            <h2 className="mt-2 text-2xl font-black">
              Create Family Reunion
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              This creates the permanent family project only. It does not
              create an event, attendee, person, or relationship automatically.
            </p>

            <div className="mt-5 grid gap-4">
              <label>
                <span className="text-xs font-bold text-slate-300">
                  Family / Reunion Name *
                </span>
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Example: Dulin Family Reunion"
                  maxLength={200}
                  className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-sm text-white"
                />
              </label>

              <label>
                <span className="text-xs font-bold text-slate-300">
                  Description
                </span>
                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Optional notes about this family genealogy project"
                  maxLength={2000}
                  rows={4}
                  className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-sm text-white"
                />
              </label>
            </div>

            {createError ? (
              <div className="mt-4 rounded-xl border border-red-800 bg-red-950/40 p-3 text-sm text-red-200">
                {createError}
              </div>
            ) : null}

            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void createFamily()}
                disabled={creating || !name.trim()}
                className="rounded-xl bg-amber-400 px-5 py-3 text-sm font-black text-slate-950 disabled:opacity-50"
              >
                {creating ? "Creating..." : "Create Family Project"}
              </button>

              <button
                type="button"
                onClick={() => {
                  setShowCreate(false);
                  setName("");
                  setDescription("");
                  setCreateError(null);
                }}
                disabled={creating}
                className="rounded-xl border border-slate-700 px-5 py-3 text-sm font-bold text-slate-300 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </section>
        ) : null}

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
              Create the first family project above. People and relationships
              are added only after the project exists.
            </p>
          </div>
        ) : (
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            {families.map((family) => (
              <Link
                key={family.id}
                href={`/admin/events/family-reunions/${family.id}`}
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
