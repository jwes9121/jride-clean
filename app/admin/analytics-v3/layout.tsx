import Link from "next/link";

export default function AnalyticsV3Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-3 px-4 py-3 md:px-6">
          <div className="text-sm font-bold text-slate-900">Analytics V3</div>
          <nav className="flex flex-wrap gap-2 text-sm">
            <Link
              href="/admin/analytics-v3"
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 font-semibold text-slate-700 hover:bg-slate-50"
            >
              Operations Overview
            </Link>
            <Link
              href="/admin/analytics-v3/passenger-growth"
              className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 font-semibold text-emerald-800 hover:bg-emerald-100"
            >
              Passenger Growth
            </Link>
          </nav>
        </div>
      </div>
      {children}
    </div>
  );
}
