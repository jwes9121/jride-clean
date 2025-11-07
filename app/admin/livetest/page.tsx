'use client';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function Page() {
  return (
    <main className="min-h-screen p-6">
      <h1 className="text-xl font-semibold mb-3">JRide /admin/livetest</h1>
      <p>This is a minimal page to verify that the route builds correctly.</p>
    </main>
  );
}
