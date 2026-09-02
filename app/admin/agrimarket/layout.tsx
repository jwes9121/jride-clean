import Link from "next/link";

export default function AgrimarketAdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <nav className="border-b bg-white px-3 py-3 text-sm sm:px-5">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2">
          <span className="mr-2 font-bold text-emerald-800">Agrimarket Admin</span>
          <Link href="/admin/agrimarket/farmers" className="rounded-lg border px-3 py-2 font-semibold">Applications and access</Link>
          <Link href="/admin/agrimarket/verified-farmers" className="rounded-lg border px-3 py-2 font-semibold">Add verified farmer</Link>
        </div>
      </nav>
      {children}
    </>
  );
}
