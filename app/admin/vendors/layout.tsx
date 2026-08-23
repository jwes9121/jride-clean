import type { ReactNode } from "react";

export default function VendorAdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="border-b bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-2 px-4 py-3">
          <a href="/admin/vendors" className="rounded-lg border bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50">
            Vendor Accounts
          </a>
          <a href="/admin/vendors/analytics" className="rounded-lg border bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50">
            Vendor Behavior
          </a>
        </div>
      </div>
      {children}
    </div>
  );
}
