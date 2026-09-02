import Link from "next/link";

export default function AgrimarketAdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <nav className="border-b bg-white px-3 py-3 sm:px-5">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2">
          <span className="mr-2 text-xs font-bold uppercase tracking-widest text-emerald-700">Agrimarket Admin</span>
          <Link href="/admin/agrimarket/farmers" className="rounded-xl border bg-white px-3 py-2 text-sm font-semibold text-slate-800">
            Applications and access
          </Link>
          <Link href="/admin/agrimarket/verified-farmers" className="rounded-xl border bg-white px-3 py-2 text-sm font-semibold text-slate-800">
            Add verified farmer
          </Link>
        </div>
      </nav>
      {children}
    </>
  );
}
