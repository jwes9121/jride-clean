export default function VendorAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <nav className="sticky top-0 z-50 border-b bg-slate-950 px-3 py-2 text-white shadow-lg">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-2">
          <span className="mr-2 text-xs font-black uppercase tracking-[0.18em] text-emerald-300">
            JRide Vendor Admin
          </span>
          <a
            href="/admin/vendors"
            className="rounded-full border border-slate-700 px-3 py-1.5 text-xs font-bold hover:border-emerald-400 hover:bg-emerald-500/10"
          >
            Vendor accounts
          </a>
          <a
            href="/admin/vendors/behavior"
            className="rounded-full border border-slate-700 px-3 py-1.5 text-xs font-bold hover:border-emerald-400 hover:bg-emerald-500/10"
          >
            Online behavior and statistics
          </a>
          <a
            href="/admin/vendors/compliance"
            className="rounded-full border border-slate-700 px-3 py-1.5 text-xs font-bold hover:border-amber-400 hover:bg-amber-500/10"
          >
            Compliance reviews
          </a>
        </div>
      </nav>
      {children}
    </>
  );
}
