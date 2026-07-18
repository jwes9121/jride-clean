import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth/requireStaff";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { renderQrDataUrl } from "@/lib/events/qr-render";
import PrintStubButton from "./PrintStubButton";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Honga Pahing Claim Stub",
  robots: {
    index: false,
    follow: false,
  },
};

const appUrl =
  process.env.NEXT_PUBLIC_APP_URL ||
  process.env.NEXT_PUBLIC_SITE_URL ||
  "https://app.jride.net";

type EventRow = {
  id: string;
  slug: string;
  name: string;
  status: string;
};

type ProgramRow = {
  id: string;
  program_key: string;
  program_name: string;
  item_label: string;
  claim_label: string;
  status: string;
};

type BeneficiaryRow = {
  id: string;
  beneficiary_code: string;
  display_name: string;
  household_head_name: string | null;
  mobile_number: string | null;
  municipality: string | null;
  barangay: string | null;
  address_text: string | null;
  member_count: number | null;
  status: string;
};

type EntitlementRow = {
  id: string;
  item_name: string;
  quantity: number | string;
  unit_label: string;
  claim_token: string;
  status: string;
  allocated_at: string;
  claimed_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
};

function formatDateTime(
  value: string | null
) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat(
    "en-PH",
    {
      timeZone: "Asia/Manila",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }
  ).format(new Date(value));
}

function formatQuantity(
  value: number | string,
  unitLabel: string
) {
  const numericValue = Number(value);

  const quantityText =
    Number.isFinite(numericValue)
      ? new Intl.NumberFormat(
          "en-PH",
          {
            maximumFractionDigits: 3,
          }
        ).format(numericValue)
      : String(value);

  return `${quantityText} ${unitLabel}`.trim();
}

function statusView(
  entitlement: EntitlementRow
) {
  if (entitlement.status === "claimed") {
    return {
      label: "CLAIMED",
      detail: entitlement.claimed_at
        ? formatDateTime(
            entitlement.claimed_at
          )
        : "Claim recorded",
      className:
        "border-emerald-700 bg-emerald-100 text-emerald-900",
    };
  }

  if (entitlement.status === "cancelled") {
    return {
      label: "CANCELLED",
      detail:
        entitlement.cancellation_reason ||
        "This entitlement is no longer valid.",
      className:
        "border-red-700 bg-red-100 text-red-900",
    };
  }

  return {
    label: "UNCLAIMED",
    detail:
      "Present this stub at the Pahing release counter.",
    className:
      "border-amber-700 bg-amber-100 text-amber-950",
  };
}

export default async function HongaHouseholdStubPage({
  params,
}: {
  params: {
    eventSlug: string;
    beneficiaryId: string;
  };
}) {
  const authorization = await requireStaff([
    "admin",
    "dispatcher",
  ]);

  if (!authorization.ok) {
    return (
      <main className="min-h-screen bg-slate-100 px-4 py-10 text-slate-950">
        <section className="mx-auto max-w-xl rounded-3xl border border-red-300 bg-white p-8 text-center shadow-xl">
          <p className="text-sm font-black uppercase tracking-[0.2em] text-red-700">
            Staff Access Required
          </p>

          <h1 className="mt-4 text-3xl font-black">
            Unable to open claim stub
          </h1>

          <p className="mt-4 text-slate-600">
            Sign in with an authorized admin or dispatcher account.
          </p>
        </section>
      </main>
    );
  }

  const eventSlug = String(
    params.eventSlug || ""
  ).trim();

  const beneficiaryId = String(
    params.beneficiaryId || ""
  ).trim();

  if (!eventSlug || !beneficiaryId) {
    notFound();
  }

  const supabase = supabaseAdmin();

  const { data: event, error: eventError } =
    await supabase
      .from("events")
      .select("id,slug,name,status")
      .eq("slug", eventSlug)
      .maybeSingle<EventRow>();

  if (eventError) {
    throw new Error(eventError.message);
  }

  if (!event?.id) {
    notFound();
  }

  const { data: program, error: programError } =
    await supabase
      .from("event_distribution_programs")
      .select(
        "id,program_key,program_name,item_label,claim_label,status"
      )
      .eq("event_id", event.id)
      .eq("program_key", "honga-pahing")
      .maybeSingle<ProgramRow>();

  if (programError) {
    throw new Error(programError.message);
  }

  if (!program?.id) {
    notFound();
  }

  const {
    data: beneficiary,
    error: beneficiaryError,
  } = await supabase
    .from("event_distribution_beneficiaries")
    .select(
      "id,beneficiary_code,display_name,household_head_name,mobile_number,municipality,barangay,address_text,member_count,status"
    )
    .eq("id", beneficiaryId)
    .eq("event_id", event.id)
    .eq("program_id", program.id)
    .maybeSingle<BeneficiaryRow>();

  if (beneficiaryError) {
    throw new Error(
      beneficiaryError.message
    );
  }

  if (!beneficiary?.id) {
    notFound();
  }

  const {
    data: entitlement,
    error: entitlementError,
  } = await supabase
    .from("event_distribution_entitlements")
    .select(
      "id,item_name,quantity,unit_label,claim_token,status,allocated_at,claimed_at,cancelled_at,cancellation_reason"
    )
    .eq("event_id", event.id)
    .eq("program_id", program.id)
    .eq("beneficiary_id", beneficiary.id)
    .maybeSingle<EntitlementRow>();

  if (entitlementError) {
    throw new Error(
      entitlementError.message
    );
  }

  if (
    !entitlement?.id ||
    !entitlement.claim_token
  ) {
    notFound();
  }

  const claimUrl =
    `${appUrl}/events/${encodeURIComponent(
      event.slug
    )}/distribution/claim?token=${encodeURIComponent(
      entitlement.claim_token
    )}`;

  const qrDataUrl =
    await renderQrDataUrl(claimUrl);

  const status =
    statusView(entitlement);

  return (
    <main className="min-h-screen bg-slate-200 px-4 py-8 text-slate-950 print:min-h-0 print:bg-white print:px-0 print:py-0">
      <section className="mx-auto max-w-3xl">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 print:hidden">
          <a
            href={`/events/${event.slug}/distribution/households`}
            className="rounded-2xl border border-slate-400 bg-white px-5 py-3 font-black"
          >
            Back to Households
          </a>

          <PrintStubButton />
        </div>

        <article className="overflow-hidden rounded-[2rem] border-4 border-slate-950 bg-white shadow-2xl print:rounded-none print:shadow-none">
          <header className="bg-slate-950 px-7 py-6 text-center text-white">
            <p className="text-xs font-black uppercase tracking-[0.35em] text-amber-300">
              JRide Events
            </p>

            <h1 className="mt-3 text-3xl font-black">
              {event.name}
            </h1>

            <p className="mt-2 text-xl font-black text-amber-300">
              Honga Pahing Claim Stub
            </p>
          </header>

          <div className="grid gap-7 p-7 md:grid-cols-[1fr_300px] print:grid-cols-[1fr_280px]">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">
                Household
              </p>

              <h2 className="mt-2 text-4xl font-black leading-tight">
                {beneficiary.display_name}
              </h2>

              <p className="mt-3 font-mono text-xl font-black">
                {beneficiary.beneficiary_code}
              </p>

              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <div className="rounded-2xl bg-slate-100 p-4">
                  <p className="text-xs font-black uppercase tracking-[0.15em] text-slate-500">
                    Household Head
                  </p>

                  <p className="mt-2 text-lg font-black">
                    {beneficiary.household_head_name ||
                      "-"}
                  </p>
                </div>

                <div className="rounded-2xl bg-slate-100 p-4">
                  <p className="text-xs font-black uppercase tracking-[0.15em] text-slate-500">
                    Members
                  </p>

                  <p className="mt-2 text-3xl font-black">
                    {beneficiary.member_count ??
                      "-"}
                  </p>
                </div>

                <div className="rounded-2xl bg-slate-100 p-4">
                  <p className="text-xs font-black uppercase tracking-[0.15em] text-slate-500">
                    Municipality
                  </p>

                  <p className="mt-2 text-lg font-black">
                    {beneficiary.municipality ||
                      "-"}
                  </p>
                </div>

                <div className="rounded-2xl bg-slate-100 p-4">
                  <p className="text-xs font-black uppercase tracking-[0.15em] text-slate-500">
                    Barangay
                  </p>

                  <p className="mt-2 text-lg font-black">
                    {beneficiary.barangay ||
                      "-"}
                  </p>
                </div>
              </div>

              {beneficiary.address_text ? (
                <div className="mt-4 rounded-2xl border border-slate-300 p-4">
                  <p className="text-xs font-black uppercase tracking-[0.15em] text-slate-500">
                    Address Details
                  </p>

                  <p className="mt-2 font-bold">
                    {beneficiary.address_text}
                  </p>
                </div>
              ) : null}

              <div className="mt-6 rounded-3xl bg-amber-100 p-6 text-amber-950">
                <p className="text-xs font-black uppercase tracking-[0.2em]">
                  Pahing Entitlement
                </p>

                <p className="mt-2 text-4xl font-black">
                  {formatQuantity(
                    entitlement.quantity,
                    entitlement.unit_label
                  )}
                </p>

                <p className="mt-2 text-lg font-bold">
                  {entitlement.item_name}
                </p>
              </div>

              <div
                className={`mt-6 rounded-2xl border-2 p-5 ${status.className}`}
              >
                <p className="text-sm font-black uppercase tracking-[0.2em]">
                  {status.label}
                </p>

                <p className="mt-2 font-bold">
                  {status.detail}
                </p>
              </div>
            </div>

            <div className="flex flex-col items-center">
              <div className="rounded-3xl border-4 border-slate-950 bg-white p-4">
                <img
                  src={qrDataUrl}
                  alt={`Honga Pahing claim QR for ${beneficiary.beneficiary_code}`}
                  className="h-[250px] w-[250px]"
                />
              </div>

              <p className="mt-4 text-center text-sm font-black uppercase tracking-[0.15em]">
                Scan at Pahing Counter
              </p>

              <div className="mt-5 w-full rounded-2xl bg-slate-100 p-4">
                <p className="text-center text-xs font-black uppercase tracking-[0.15em] text-slate-500">
                  Claim Token
                </p>

                <p className="mt-2 break-all text-center font-mono text-xs font-black">
                  {entitlement.claim_token}
                </p>
              </div>

              <div className="mt-5 w-full rounded-2xl border border-slate-300 p-4 text-center text-sm">
                <p className="font-black">
                  Allocated
                </p>

                <p className="mt-1 text-slate-600">
                  {formatDateTime(
                    entitlement.allocated_at
                  )}
                </p>
              </div>
            </div>
          </div>

          <footer className="border-t-2 border-dashed border-slate-400 px-7 py-5 text-center">
            <p className="font-black">
              Present this original stub during distribution.
            </p>

            <p className="mt-1 text-sm text-slate-600">
              Duplicate scans will show the original claim record and will not create another release.
            </p>
          </footer>
        </article>
      </section>
    </main>
  );
}
