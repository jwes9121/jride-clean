import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { renderQrDataUrl } from "@/lib/events/qr-render";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const appUrl =
  process.env.NEXT_PUBLIC_APP_URL ||
  process.env.NEXT_PUBLIC_SITE_URL ||
  "https://app.jride.net";

type EventRow = {
  id: string;
  slug: string;
  name: string;
  short_name: string | null;
  event_date: string | null;
  venue: string | null;
  group_label: string | null;
};

type AttendeeRow = {
  id: string;
  full_name: string;
  nickname: string | null;
  group_value: string;
  registration_number: string;
  qr_token: string;
  attendance_status: string;
  checked_in_at: string | null;
  is_disqualified: boolean;
  disqualification_reason: string | null;
};

type GuestLinkRow = {
  relationship: string;
  guest:
    | {
        id: string;
        full_name: string;
        registration_number: string;
        attendance_status: string;
      }
    | {
        id: string;
        full_name: string;
        registration_number: string;
        attendance_status: string;
      }[]
    | null;
};

function formatDate(value: string | null): string {
  if (!value) return "Date to be announced";
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

function formatCheckedIn(value: string | null): string {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(value));
}

function initials(name: string): string {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "JP";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function avatarClass(name: string): string {
  const palette = [
    "from-red-700 to-red-500",
    "from-amber-700 to-amber-500",
    "from-blue-700 to-blue-500",
    "from-emerald-700 to-emerald-500",
    "from-violet-700 to-violet-500",
    "from-slate-700 to-slate-500",
  ];
  let hash = 0;
  for (const char of String(name || "")) hash += char.charCodeAt(0);
  return palette[hash % palette.length];
}

function statusView(attendee: AttendeeRow) {
  if (attendee.is_disqualified) {
    return {
      label: "Invalid",
      detail: attendee.disqualification_reason || "Please proceed to the Help Desk.",
      className: "border-red-300 bg-red-100 text-red-800",
      dotClassName: "bg-red-600",
    };
  }

  if (attendee.attendance_status === "checked_in") {
    return {
      label: "Checked In",
      detail: attendee.checked_in_at ? formatCheckedIn(attendee.checked_in_at) : "",
      className: "border-emerald-300 bg-emerald-100 text-emerald-800",
      dotClassName: "bg-emerald-600",
    };
  }

  return {
    label: "Registered",
    detail: "Not yet checked in",
    className: "border-emerald-300 bg-emerald-100 text-emerald-800",
    dotClassName: "bg-emerald-600",
  };
}

function normalizeGuests(rows: GuestLinkRow[]) {
  return rows
    .map((row) => {
      const guest = Array.isArray(row.guest) ? row.guest[0] : row.guest;
      if (!guest) return null;
      return {
        id: guest.id,
        name: guest.full_name,
        registrationNumber: guest.registration_number,
        attendanceStatus: guest.attendance_status,
        relationship: row.relationship,
      };
    })
    .filter(Boolean) as {
    id: string;
    name: string;
    registrationNumber: string;
    attendanceStatus: string;
    relationship: string;
  }[];
}

function unavailablePass() {
  return (
    <main className="min-h-screen bg-slate-950 px-6 py-12 text-white">
      <section className="mx-auto max-w-md rounded-3xl border border-slate-800 bg-slate-900 p-8 text-center shadow-2xl">
        <p className="text-sm font-semibold uppercase tracking-[0.25em] text-amber-300">
          JRide Events
        </p>
        <h1 className="mt-5 text-3xl font-bold">Event Pass unavailable.</h1>
        <p className="mt-4 text-slate-300">
          Use Find My Event Pass to retrieve your latest Event Pass.
        </p>
        <a
          href="/events"
          className="mt-8 inline-flex rounded-xl bg-amber-400 px-5 py-3 font-semibold text-slate-950"
        >
          Find My Event Pass
        </a>
      </section>
    </main>
  );
}

export default async function EventPassPage({
  params,
  searchParams,
}: {
  params: { eventSlug: string; registrationNumber: string };
  searchParams: { token?: string };
}) {
  const token = String(searchParams?.token || "").trim();
  if (!token) return unavailablePass();

  const supabase = supabaseAdmin();

  const { data: event } = await supabase
    .from("events")
    .select("id,slug,name,short_name,event_date,venue,group_label")
    .eq("slug", params.eventSlug)
    .eq("status", "published")
    .maybeSingle<EventRow>();

  if (!event?.id) return unavailablePass();

  const { data: attendee } = await supabase
    .from("event_attendees")
    .select(
      "id,full_name,nickname,group_value,registration_number,qr_token,attendance_status,checked_in_at,is_disqualified,disqualification_reason"
    )
    .eq("event_id", event.id)
    .eq("registration_number", decodeURIComponent(params.registrationNumber))
    .eq("qr_token", token)
    .is("merged_into", null)
    .maybeSingle<AttendeeRow>();

  if (!attendee?.id) return unavailablePass();

  const { data: guestRows } = await supabase
    .from("event_guest_links")
    .select(
      "relationship,guest:event_attendees!event_guest_links_guest_attendee_id_fkey(id,full_name,registration_number,attendance_status)"
    )
    .eq("event_id", event.id)
    .eq("primary_attendee_id", attendee.id)
    .order("created_at", { ascending: true })
    .returns<GuestLinkRow[]>();

  const status = statusView(attendee);
  const guestList = normalizeGuests(guestRows || []);
  const groupLabel = event.group_label || "Group";
  const afterEventDate = formatDate(event.event_date);
  const passUrl = `/events/${encodeURIComponent(
    event.slug
  )}/pass/${encodeURIComponent(attendee.registration_number)}?token=${encodeURIComponent(
    attendee.qr_token
  )}`;
  const qrDataUrl = await renderQrDataUrl(passUrl);

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-white print:bg-white print:p-0">
      <style>{`
        @media print {
          body {
            background: white !important;
          }

          .no-print {
            display: none !important;
          }

          #event-pass-card {
            box-shadow: none !important;
            margin: 0 auto !important;
            max-width: 380px !important;
            border: 1px solid #cccccc !important;
            page-break-inside: avoid !important;
          }

          @page {
            margin: 1cm;
          }
        }
      `}</style>

      <section className="mx-auto max-w-md">
        <div
          id="event-pass-card"
          className="overflow-hidden rounded-[2rem] border border-slate-800 bg-white text-slate-950 shadow-2xl"
        >
          <div className="bg-gradient-to-br from-red-950 via-slate-950 to-amber-900 px-6 py-7 text-center text-white">
            <p className="text-sm font-semibold tracking-[0.2em] text-amber-200">
              Welcome Home.
            </p>
            <h1 className="mt-3 text-2xl font-bold leading-tight">
              {event.name}
            </h1>
            <p className="mt-3 text-xs uppercase tracking-[0.25em] text-slate-300">
              Digital Event Platform
            </p>
            <p className="mt-1 text-sm text-slate-300">
              Powered by JRide Corporation
            </p>
          </div>

          <div className="px-6 py-6">
            <p className="text-center text-xs font-bold uppercase tracking-[0.35em] text-slate-500">
              Event Pass
            </p>

            <div
              className={`mx-auto mt-5 flex w-fit items-center gap-2 rounded-full border px-4 py-2 text-sm font-bold ${status.className}`}
            >
              <span className={`h-2.5 w-2.5 rounded-full ${status.dotClassName}`} />
              <span>{status.label}</span>
              {status.detail ? (
                <span className="font-semibold opacity-80">- {status.detail}</span>
              ) : null}
            </div>

            <div className="mt-7 flex flex-col items-center text-center">
              <div
                className={`flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br ${avatarClass(
                  attendee.full_name
                )} text-2xl font-black text-white shadow-lg`}
              >
                {initials(attendee.full_name)}
              </div>

              <h2 className="mt-5 text-3xl font-black leading-tight">
                {attendee.full_name}
              </h2>

              {attendee.nickname ? (
                <p className="mt-1 text-sm font-semibold text-slate-500">
                  {attendee.nickname}
                </p>
              ) : null}

              <p className="mt-3 text-lg font-bold text-slate-700">
                {groupLabel} {attendee.group_value}
              </p>

              <div className="mt-5 rounded-2xl bg-slate-100 px-5 py-4">
                <p className="text-xs font-bold uppercase tracking-[0.25em] text-slate-500">
                  Pass No.
                </p>
                <p className="mt-2 font-mono text-2xl font-black tracking-tight">
                  {attendee.registration_number}
                </p>
              </div>
            </div>

            <div className="mx-auto mt-7 flex h-72 w-72 items-center justify-center rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <img
                src={qrDataUrl}
                alt={`Event Pass QR for ${attendee.registration_number}`}
                className="h-full w-full"
              />
            </div>

            {guestList.length > 0 ? (
              <div className="mt-7 rounded-2xl border border-slate-200 bg-slate-50 p-5">
                <h3 className="text-sm font-black uppercase tracking-[0.2em] text-slate-500">
                  Guests & Family
                </h3>
                <div className="mt-4 space-y-3">
                  {guestList.map((guest) => (
                    <div key={guest.id} className="flex items-start gap-3">
                      <span className="mt-1 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-[10px] font-black text-emerald-700">
                        OK
                      </span>
                      <div>
                        <p className="font-bold">{guest.name}</p>
                        <p className="text-sm text-slate-500">
                          {guest.relationship} - {guest.registrationNumber}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="no-print mt-7 grid gap-3">
              <button
                type="button"
                className="rounded-2xl bg-slate-950 px-5 py-4 text-base font-bold text-white"
              >
                Save Event Pass
              </button>
              <button
                type="button"
                className="rounded-2xl border border-slate-300 px-5 py-4 text-base font-bold text-slate-950"
              >
                Print Event Pass
              </button>
            </div>

            <div className="no-print mt-7 border-t border-slate-200 pt-5 text-center">
              <p className="text-sm font-semibold text-slate-500">
                Need another copy?
              </p>
              <a href="/events" className="mt-2 inline-flex font-bold text-red-800">
                Find My Event Pass
              </a>
            </div>

            <div className="no-print mt-7 rounded-2xl bg-slate-100 p-5 text-center">
              <p className="text-sm font-black uppercase tracking-[0.2em] text-slate-500">
                After the Event
              </p>
              <p className="mt-3 text-sm font-semibold text-slate-600">
                Photos, certificates, and announcements will appear here after{" "}
                {afterEventDate}.
              </p>
            </div>

            <p className="mt-7 text-center text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
              Verified by JRide Events
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}

