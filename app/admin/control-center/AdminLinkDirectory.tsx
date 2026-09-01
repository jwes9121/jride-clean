"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

type AdminLinkItem = {
  title: string;
  href: string;
  description: string;
  badge?: string;
  keywords?: string;
};

type AdminLinkGroup = {
  title: string;
  description: string;
  links: AdminLinkItem[];
};

const ADMIN_LINK_GROUPS: AdminLinkGroup[] = [
  {
    title: "Dispatch and live operations",
    description: "Daily trip monitoring, assignment, service queues, and incident response.",
    links: [
      {
        title: "LiveTrips",
        href: "/admin/livetrips",
        description: "Live map, driver locator, active trips, and trip actions.",
        badge: "Primary",
        keywords: "map locate driver search command center",
      },
      {
        title: "Dispatch Workspace",
        href: "/admin/dispatch",
        description: "Open the shared Ride and Errand dispatch workspace.",
        badge: "Primary",
        keywords: "ride errand assignment escalation dispatcher",
      },
      {
        title: "Ride Dispatch",
        href: "/admin/ride-dispatch",
        description: "Assign drivers and manage the Ride queue.",
        badge: "Primary",
        keywords: "rides assignment regular booking",
      },
      {
        title: "Takeout Dispatch",
        href: "/admin/takeout-dispatch",
        description: "Assign accepted Takeout orders and manage delivery status.",
        badge: "Primary",
        keywords: "food order vendor delivery rider",
      },
      {
        title: "Advance Booking Dispatch",
        href: "/admin/advance-booking-dispatch",
        description: "Monitor and dispatch scheduled Ride bookings.",
        badge: "Primary",
        keywords: "scheduled future reservation",
      },
      {
        title: "Takeout Operations",
        href: "/admin/takeout-ops",
        description: "Monitor Takeout orders and perform supported recovery actions.",
        badge: "Restricted action",
        keywords: "food orders monitoring",
      },
      {
        title: "Driver Duty Check",
        href: "/admin/driver-availability-pings",
        description: "Issue and review driver availability and security checks.",
        badge: "Primary",
        keywords: "dutycheck duty security ping online incentive",
      },
      {
        title: "Ride Rescue Mode",
        href: "/admin/rescue-mode",
        description: "Manage temporary visiting-driver rescue coverage.",
        keywords: "service town visiting driver coverage",
      },
      {
        title: "Stuck Trips",
        href: "/admin/stuck-trips",
        description: "Review trips that stopped progressing through the lifecycle.",
        badge: "Read-only",
        keywords: "watcher stale trip",
      },
      {
        title: "At-Risk Trips",
        href: "/admin/trips/at-risk",
        description: "Review SLA risks and escalation candidates.",
        badge: "Read-only",
        keywords: "stale escalation delay",
      },
      {
        title: "Operations Health",
        href: "/admin/ops/health",
        description: "View operational health checks and current warnings.",
        badge: "Read-only",
        keywords: "system monitoring status",
      },
      {
        title: "Operations Incidents",
        href: "/admin/ops/incidents",
        description: "Review the operational incident log.",
        badge: "Read-only",
        keywords: "errors failures outage",
      },
    ],
  },
  {
    title: "Drivers, passengers, and incentives",
    description: "People, access, verification, service towns, quality, and driver rewards.",
    links: [
      {
        title: "Drivers",
        href: "/admin/drivers",
        description: "Manage driver records and online or offline state.",
        badge: "Primary",
        keywords: "roster account vehicle municipality",
      },
      {
        title: "Users and Roles",
        href: "/admin/users",
        description: "Manage staff users and role assignments.",
        keywords: "admin dispatcher access account",
      },
      {
        title: "Towns",
        href: "/admin/towns",
        description: "Manage service towns and display colors.",
        keywords: "municipality zone",
      },
      {
        title: "Passenger Verification",
        href: "/admin/verification",
        description: "Approve or reject passenger verification requests.",
        badge: "Primary",
        keywords: "identity id photo passenger",
      },
      {
        title: "Dispatcher Verification Queue",
        href: "/admin/dispatcher-verifications",
        description: "Open the dispatcher pre-screen verification queue.",
        keywords: "identity passenger review",
      },
      {
        title: "Driver Incentive Awards",
        href: "/admin/incentive-awards",
        description: "Review qualification and record incentive awards.",
        badge: "Primary",
        keywords: "weekly load clamp shirt power bank thermal bag phone reward",
      },
      {
        title: "Trip Ratings",
        href: "/admin/ratings",
        description: "Review completed-trip passenger ratings and feedback.",
        keywords: "quality driver feedback stars",
      },
    ],
  },
  {
    title: "Vendors, Takeout, and Agrimarket",
    description: "Vendor accounts, behavior, compliance, settlements, and farmer onboarding.",
    links: [
      {
        title: "Vendor Accounts",
        href: "/admin/vendors",
        description: "Manage vendor records, access, and account status.",
        badge: "Primary",
        keywords: "store merchant restaurant shop",
      },
      {
        title: "Vendor Behavior",
        href: "/admin/vendors/behavior",
        description: "Review vendor online behavior and order statistics.",
        keywords: "attendance performance store online",
      },
      {
        title: "Vendor Compliance",
        href: "/admin/vendors/compliance",
        description: "Review vendor compliance cases and suspension decisions.",
        keywords: "store review suspension enforcement",
      },
      {
        title: "Vendor Payouts",
        href: "/admin/vendor-payouts",
        description: "Approve and track vendor payout requests.",
        keywords: "settlement payment store",
      },
      {
        title: "Vendor Payout Summary",
        href: "/admin/vendor-payouts-summary",
        description: "Review vendor payout totals and exportable summaries.",
        badge: "Read-only",
        keywords: "settlement report accounting",
      },
      {
        title: "Agrimarket Farmer Applications",
        href: "/admin/agrimarket/farmers",
        description: "Review and decide Agrimarket farmer applications.",
        keywords: "producer onboarding agriculture",
      },
    ],
  },
  {
    title: "Finance and wallets",
    description: "Accounting review, wallet controls, payout queues, and reconciliation.",
    links: [
      {
        title: "Finance Summary",
        href: "/admin/finance/summary",
        description: "View the consolidated financial summary.",
        badge: "Read-only",
        keywords: "accounting revenue expense",
      },
      {
        title: "Finance Inbox",
        href: "/admin/finance/inbox",
        description: "Review pending finance items before posting.",
        keywords: "accounting approval queue",
      },
      {
        title: "Manual Expenses",
        href: "/admin/finance/expenses",
        description: "Record and review manual expense entries.",
        keywords: "accounting cost receipt",
      },
      {
        title: "Wallet Adjust",
        href: "/admin/wallet-adjust",
        description: "Apply authorized driver wallet adjustments.",
        badge: "Admin action",
        keywords: "balance topup debit credit",
      },
      {
        title: "Wallet Reconciliation",
        href: "/admin/ops/wallet-reconciliation",
        description: "Review wallet settlement differences and reconciliation status.",
        keywords: "balance ledger mismatch settlement",
      },
      {
        title: "Driver Payouts",
        href: "/admin/driver-payouts",
        description: "Approve and track driver payout requests.",
        badge: "Primary",
        keywords: "cashout gcash payment",
      },
      {
        title: "Driver Payout Reports",
        href: "/admin/payouts/drivers/reports",
        description: "Review payout reports and run supported payout approval actions.",
        badge: "Restricted action",
        keywords: "cashout accounting",
      },
    ],
  },
  {
    title: "Analytics, reports, and audit",
    description: "Operational evidence, performance analysis, exports, and audit trails.",
    links: [
      {
        title: "Analytics V3",
        href: "/admin/analytics-v3",
        description: "Open current operational, incentive, and location analytics.",
        badge: "Primary",
        keywords: "driver hours location observation incentive tickets",
      },
      {
        title: "Analytics Center",
        href: "/admin/analytics",
        description: "Open the broad trip, revenue, driver, and vendor analytics center.",
        badge: "Broad view",
        keywords: "trips revenue ratings",
      },
      {
        title: "Audit Trail",
        href: "/admin/audit",
        description: "Review the read-only administrative audit timeline.",
        badge: "Read-only",
        keywords: "history actions evidence",
      },
      {
        title: "Reassign Audit",
        href: "/admin/reassign-audit",
        description: "Review driver reassignment history.",
        badge: "Read-only",
        keywords: "dispatch assignment history",
      },
      {
        title: "LGU and Accounting Exports",
        href: "/admin/reports/lgu",
        description: "Generate vendor and driver export views.",
        badge: "Read-only",
        keywords: "municipality report csv",
      },
      {
        title: "Stuck Driver Report",
        href: "/admin/reports/stuck-drivers",
        description: "Open the stuck-driver reporting view.",
        badge: "Read-only",
        keywords: "online stale report",
      },
    ],
  },
  {
    title: "Platform administration and events",
    description: "Platform configuration, event operations, and controlled overrides.",
    links: [
      {
        title: "Service Overrides",
        href: "/admin/overrides",
        description: "Review the ordinance override audit log.",
        badge: "Read-only",
        keywords: "exception control history",
      },
      {
        title: "Admin Actions",
        href: "/admin/actions",
        description: "Look up bookings and send supported administrative status actions.",
        badge: "Restricted action",
        keywords: "booking lifecycle status intervention",
      },
      {
        title: "Events Platform",
        href: "/events/platform",
        description: "Open the event platform and select an event workspace.",
        badge: "Portal",
        keywords: "attendance scanner raffle command center",
      },
      {
        title: "Events Directory",
        href: "/events",
        description: "Open the available public event list.",
        badge: "Portal",
        keywords: "registration attendance",
      },
      {
        title: "Family Reunions",
        href: "/admin/events/family-reunions",
        description: "Open family reunion administration and family trees.",
        keywords: "event genealogy registration",
      },
    ],
  },
  {
    title: "Operational diagnostics",
    description: "Verified read-only investigation pages used during operations review.",
    links: [
      {
        title: "Passenger Count Mismatches",
        href: "/admin/ops/pax-mismatches",
        description: "Inspect driver-reported passenger-count mismatches.",
        badge: "Read-only",
        keywords: "pax identity booking diagnostic",
      },
    ],
  },
];

const DISPATCHER_LINKS = new Set([
  "/admin/livetrips",
  "/admin/dispatch",
  "/admin/ride-dispatch",
  "/admin/takeout-dispatch",
  "/admin/advance-booking-dispatch",
  "/admin/takeout-ops",
  "/admin/driver-availability-pings",
  "/admin/stuck-trips",
  "/admin/trips/at-risk",
  "/admin/ops/health",
  "/admin/ops/incidents",
  "/admin/dispatcher-verifications",
  "/admin/ratings",
  "/admin/analytics-v3",
  "/admin/analytics",
  "/admin/audit",
  "/admin/reassign-audit",
  "/admin/reports/stuck-drivers",
  "/admin/ops/pax-mismatches",
]);

function searchableText(group: AdminLinkGroup, item: AdminLinkItem) {
  return [
    group.title,
    group.description,
    item.title,
    item.href,
    item.description,
    item.badge,
    item.keywords,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export default function AdminLinkDirectory({ role }: { role: string }) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();

  const accessibleGroups = useMemo(() => {
    if (role === "admin") return ADMIN_LINK_GROUPS;
    if (role !== "dispatcher") return [];

    return ADMIN_LINK_GROUPS.map((group) => ({
      ...group,
      links: group.links.filter((item) => DISPATCHER_LINKS.has(item.href)),
    })).filter((group) => group.links.length > 0);
  }, [role]);

  const visibleGroups = useMemo(() => {
    if (!normalizedQuery) return accessibleGroups;

    return accessibleGroups.map((group) => ({
      ...group,
      links: group.links.filter((item) =>
        searchableText(group, item).includes(normalizedQuery)
      ),
    })).filter((group) => group.links.length > 0);
  }, [accessibleGroups, normalizedQuery]);

  const totalLinks = accessibleGroups.reduce(
    (total, group) => total + group.links.length,
    0
  );
  const visibleLinks = visibleGroups.reduce(
    (total, group) => total + group.links.length,
    0
  );

  if (role !== "admin" && role !== "dispatcher") {
    return (
      <section className="mt-6 rounded-3xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-600 shadow-sm">
        {role === "checking"
          ? "Checking your staff access before showing admin links..."
          : "Your authenticated staff role could not be confirmed."}
      </section>
    );
  }

  return (
    <section className="mt-6 rounded-3xl border border-slate-200 bg-slate-50 p-4 shadow-sm sm:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">
            Central admin directory
          </div>
          <h2 className="mt-1 text-2xl font-black text-slate-950">
            {role === "admin" ? "All Admin Tools" : "Dispatcher Tools"}
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            Search and open the JRide tools available to your authenticated staff role from one
            place. Unsupported test, broken, and identifier-only pages are intentionally excluded.
          </p>
        </div>

        <div className="w-full lg:max-w-xl">
          <label htmlFor="admin-tool-search" className="mb-1 block text-xs font-bold text-slate-700">
            Find an admin tool
          </label>
          <div className="flex gap-2">
            <input
              id="admin-tool-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search vendors, duty check, payouts, analytics..."
              autoComplete="off"
              className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-100"
              >
                Clear
              </button>
            ) : null}
          </div>
          <div className="mt-1 text-xs text-slate-500" aria-live="polite">
            {normalizedQuery
              ? visibleLinks + " of " + totalLinks + " tools match"
              : totalLinks + " verified tools available for " + role}
          </div>
        </div>
      </div>

      {visibleGroups.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-600">
          No admin tool matches "{query.trim()}".
        </div>
      ) : (
        <div className="mt-6 space-y-7">
          {visibleGroups.map((group) => (
            <div key={group.title}>
              <div className="mb-3">
                <h3 className="text-base font-black text-slate-950">{group.title}</h3>
                <p className="text-xs text-slate-600">{group.description}</p>
              </div>

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {group.links.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="group flex min-h-36 flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-400 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="font-black text-slate-950 group-hover:text-emerald-800">
                        {item.title}
                      </div>
                      {item.badge ? (
                        <span className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600">
                          {item.badge}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-2 flex-1 text-xs leading-5 text-slate-600">
                      {item.description}
                    </p>
                    <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
                      <code className="min-w-0 truncate text-[10px] text-slate-500">{item.href}</code>
                      <span className="shrink-0 text-xs font-black text-emerald-700">Open</span>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
