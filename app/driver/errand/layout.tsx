import type { ReactNode } from "react";

export default function DriverErrandLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-950">
      <div className="border-b border-slate-800 bg-slate-950 px-4 py-2 text-slate-200">
        <div className="mx-auto flex max-w-4xl items-center gap-2 text-xs">
          <span className="mr-1 font-semibold text-emerald-400">JRide Errand</span>
          <a href="/driver/errand" className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 hover:bg-slate-800">
            Offer / Stage 0
          </a>
          <a href="/driver/errand/execution" className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 hover:bg-slate-800">
            Execution
          </a>
        </div>
      </div>
      {children}
    </div>
  );
}
