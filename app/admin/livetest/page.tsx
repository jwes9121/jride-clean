@'
"use client";

export default function Page() {
  return (
    <main className="min-h-screen bg-slate-50">
      <div className="max-w-5xl mx-auto px-4 py-10">
        <h1 className="text-2xl font-semibold mb-4">
          JRide /admin/livetest
        </h1>
        <p className="text-slate-700">
          This is a minimal page to verify the <code>/admin/livetest</code>{" "}
          route works in local and Vercel builds.
        </p>
      </div>
    </main>
  );
}
'@ | Set-Content -Encoding utf8 .\app\admin\livetest\page.tsx
