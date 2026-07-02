import { notFound } from "next/navigation";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

export default async function EventHomePage({ params }: { params: { eventSlug: string } }) {
  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  const { data: event } = await supabase
    .from("events")
    .select("id,slug,name,short_name,event_date,venue,description,status,group_label")
    .eq("slug", params.eventSlug)
    .eq("status", "published")
    .maybeSingle();

  if (!event) notFound();

  const { data: page } = await supabase
    .from("event_pages")
    .select("hero_title,hero_subtitle,registration_message,theme_color")
    .eq("event_id", event.id)
    .maybeSingle();

  return (
    <main className="min-h-screen bg-white px-6 py-10 text-slate-950">
      <section className="mx-auto max-w-5xl">
        <p className="text-sm font-semibold uppercase tracking-[0.25em] text-red-800">
          Powered by JRide Corporation
        </p>
        <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-6xl">
          {page?.hero_title || event.name}
        </h1>
        <p className="mt-4 max-w-2xl text-lg text-slate-700">
          {page?.registration_message || event.description || "Register early for faster check-in."}
        </p>

        <div className="mt-10 grid gap-4 sm:grid-cols-3">
          <a className="rounded-2xl border p-5 font-semibold" href={`/events/${event.slug}/register`}>
            Register
          </a>
          <a className="rounded-2xl border p-5 font-semibold" href={`/events/${event.slug}/live`}>
            Live Dashboard
          </a>
          <a className="rounded-2xl border p-5 font-semibold" href={`/events/${event.slug}/gallery`}>
            Gallery
          </a>
        </div>
      </section>
    </main>
  );
}
