import Link from "next/link";
import LiveTripsClient, {
  type LiveTripsServiceFilter,
} from "./LiveTripsClient";
import AdvanceBookingDispatchPanel from "./components/AdvanceBookingDispatchPanel";
import AgrimarketDispatchGate from "./components/AgrimarketDispatchGate";

type DispatchService =
  | "all"
  | "ride"
  | "takeout"
  | "advance"
  | "errand"
  | "agrimarket";

const SERVICE_TABS: Array<{
  key: DispatchService;
  label: string;
  description: string;
}> = [
  { key: "all", label: "Overview", description: "All live operations" },
  { key: "ride", label: "Ride", description: "Motorcycle and tricycle" },
  { key: "takeout", label: "Takeout", description: "Vendor delivery orders" },
  { key: "advance", label: "Advance Booking", description: "Scheduled rides" },
  { key: "errand", label: "Errand", description: "Errand jobs" },
  { key: "agrimarket", label: "AgriMarket", description: "Farm delivery dispatch" },
];

function normalizeService(
  value: string | string[] | undefined
): DispatchService {
  const raw = String(Array.isArray(value) ? value[0] || "" : value || "")
    .trim()
    .toLowerCase();

  if (
    raw === "ride" ||
    raw === "takeout" ||
    raw === "advance" ||
    raw === "errand" ||
    raw === "agrimarket"
  ) {
    return raw;
  }

  return "all";
}

function tabClass(active: boolean) {
  return [
    "min-w-[128px] rounded-2xl border px-4 py-3 text-left transition",
    active
      ? "border-slate-900 bg-slate-900 text-white shadow-sm"
      : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50",
  ].join(" ");
}

export default function LiveTripsPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const activeService = normalizeService(searchParams?.service);

  const liveTripsFilter: LiveTripsServiceFilter =
    activeService === "ride" ||
    activeService === "takeout" ||
    activeService === "errand"
      ? activeService
      : "all";

  return (
    <main className="min-h-screen bg-slate-100">
      <section className="border-b border-slate-200 bg-white px-4 py-4 md:px-6">
        <div className="mx-auto max-w-[1800px]">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">
                JRide Operations
              </div>
              <h1 className="mt-1 text-3xl font-black tracking-tight text-slate-950">
                Dispatch Center
              </h1>
              <p className="mt-1 text-sm text-slate-600">
                One dispatch workspace for Ride, Takeout, Advance Booking,
                Errand, and AgriMarket.
              </p>
            </div>
            <div className="text-xs text-slate-500">
              Single staff entry point: /admin/livetrips
            </div>
          </div>

          <nav
            className="mt-4 flex gap-2 overflow-x-auto pb-1"
            aria-label="Dispatch services"
          >
            {SERVICE_TABS.map((tab) => {
              const href =
                tab.key === "all"
                  ? "/admin/livetrips"
                  : "/admin/livetrips?service=" + tab.key;
              const active = activeService === tab.key;

              return (
                <Link
                  key={tab.key}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={tabClass(active)}
                >
                  <span className="block text-sm font-bold">{tab.label}</span>
                  <span
                    className={[
                      "mt-0.5 block text-[11px]",
                      active ? "text-slate-300" : "text-slate-500",
                    ].join(" ")}
                  >
                    {tab.description}
                  </span>
                </Link>
              );
            })}
          </nav>
        </div>
      </section>

      <div className="mx-auto max-w-[1800px]">
        {activeService === "advance" ? (
          <AdvanceBookingDispatchPanel />
        ) : activeService === "agrimarket" ? (
          <div className="p-3 md:p-4">
            <AgrimarketDispatchGate />
          </div>
        ) : (
          <>
            {activeService === "all" ? (
              <div className="px-3 pt-3 md:px-4 md:pt-4">
                <AgrimarketDispatchGate />
              </div>
            ) : null}
            <LiveTripsClient serviceFilter={liveTripsFilter} />
          </>
        )}
      </div>
    </main>
  );
}
