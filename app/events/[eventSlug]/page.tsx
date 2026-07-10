import { notFound } from "next/navigation";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

function formatEventDate(value: string | null) {
  if (!value) return "Date to be announced";

  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

function daysUntil(value: string | null) {
  if (!value) return null;

  const today = new Date();
  const target = new Date(`${value}T00:00:00`);

  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);

  return Math.max(0, Math.ceil((target.getTime() - today.getTime()) / 86400000));
}

export default async function EventHomePage({ params }: { params: { eventSlug: string } }) {
  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  const { data: event } = await supabase
    .from("events")
    .select("id,slug,name,event_date,venue,description,status")
    .eq("slug", params.eventSlug)
    .eq("status", "published")
    .maybeSingle();

  if (!event) notFound();

  const { data: page } = await supabase
    .from("event_pages")
    .select("hero_title,hero_subtitle,registration_message,theme_color")
    .eq("event_id", event.id)
    .maybeSingle();

  const eventDate = formatEventDate(event.event_date);
  const remainingDays = daysUntil(event.event_date);

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-10 text-white">
      <section className="mx-auto max-w-6xl">
        <p className="text-sm font-semibold uppercase tracking-[0.25em] text-amber-300">
          JRide Events Platform
        </p>

        <div className="mt-6 rounded-3xl border border-slate-800 bg-slate-900 p-8 shadow-2xl">
          <p className="text-sm font-semibold uppercase tracking-[0.25em] text-red-300">
            Powered by JRide Corporation
          </p>

          <h1 className="mt-5 max-w-4xl text-4xl font-bold tracking-tight sm:text-6xl">
            {page?.hero_title || event.name}
          </h1>

          <p className="mt-5 max-w-3xl text-lg text-slate-300">
            {page?.hero_subtitle || event.description || "Digital registration, QR check-in, live attendance, and raffle experience."}
          </p>

          <div className="mt-8 grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-700 bg-slate-950 p-5">
              <p className="text-sm uppercase tracking-[0.2em] text-slate-400">
                Event Date
              </p>
              <p className="mt-2 text-2xl font-bold">{eventDate}</p>
            </div>

            <div className="rounded-2xl border border-slate-700 bg-slate-950 p-5">
              <p className="text-sm uppercase tracking-[0.2em] text-slate-400">
                Countdown
              </p>
              <p className="mt-2 text-2xl font-bold">
                {remainingDays === null ? "Coming soon" : `${remainingDays} days`}
              </p>
            </div>

            <div className="rounded-2xl border border-slate-700 bg-slate-950 p-5">
              <p className="text-sm uppercase tracking-[0.2em] text-slate-400">
                Venue
              </p>
              <p className="mt-2 text-2xl font-bold">
                {event.venue || "Venue to be announced"}
              </p>
            </div>
          </div>

          <p className="mt-8 max-w-3xl rounded-2xl bg-amber-400 p-5 font-semibold text-slate-950">
            {page?.registration_message || "Register early and present your Event Pass QR at the entrance for faster check-in."}
          </p>
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-4">
          <a
            href={`/events/${event.slug}/register`}
            className="rounded-2xl border border-amber-400 bg-amber-400 p-5 text-slate-950 transition hover:opacity-90"
          >
            <h2 className="text-xl font-black">Register</h2>
            <p className="mt-2 text-sm font-semibold">Register for this event</p>
          </a>

          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <h2 className="text-xl font-bold">Program</h2>
            <p className="mt-2 text-sm text-slate-400">Coming soon</p>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <h2 className="text-xl font-bold">Raffle</h2>
            <p className="mt-2 text-sm text-slate-400">
              Live digital raffle during the event
            </p>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <h2 className="text-xl font-bold">Sponsors</h2>
            <p className="mt-2 text-sm text-slate-400">Coming soon</p>
          </div>
        </div>

        <footer className="mt-12 border-t border-slate-800 pt-6 text-sm text-slate-500">
          Powered by JRide Corporation. JRide Events Platform.
        </footer>
      </section>
    </main>
  );
}
