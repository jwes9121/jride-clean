export const dynamic = 'force-dynamic';
export const revalidate = 0;

'use client';

export default function Page() {
  return (
    <main className="p-6">
      <h1 className="text-xl font-semibold">JRide /admin/livetest</h1>
      <p className="mt-2 text-sm text-gray-600">
        This is a minimal page to verify the route works.
      </p>
    </main>
  );
}
