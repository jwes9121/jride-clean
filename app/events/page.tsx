import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

export default async function EventsPage() {
  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  const { data: events } = await supabase
    .from("events")
    .select("slug,name,short_name,event_date,venue,description,status")
    .eq("status", "published")
    .order("event_date", { ascending: true });

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-10 text-white">
      <section className="mx-auto max-w-5xl">
        <p className="text-sm font-semibold uppercase tracking-[0.25em] text-amber-300">
          Digital Event Platform
        </p>
        <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-6xl">
          JRide Events
        </h1>
        <p className="mt-4 max-w-2xl text-lg text-slate-300">
          Registration, QR check-in, live attendance, digital raffle, and event insights powered by JRide Corporation.
        </p>

        <div className="mt-10 space-y-4">
          {(events || []).map((event) => (
            <a
              key={event.slug}
              href={`/events/${event.slug}`}
              className="block rounded-2xl border border-slate-700 bg-slate-900 p-6"
            >
              <p className="text-sm uppercase tracking-[0.2em] text-slate-400">
                Upcoming Event
              </p>
              <h2 className="mt-3 text-2xl font-bold">{event.name}</h2>
              <p className="mt-2 text-slate-300">
                {event.description || "Digital event registration and check-in."}
              </p>
            </a>
          ))}
        </div>
      </section>
    </main>
  );
}
