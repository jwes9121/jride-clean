'use client';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type DriverPoint = {
  id: string;
  lat: number;
  lng: number;
  status: 'online' | 'offline';
};

const MOCK_DRIVERS: DriverPoint[] = [];

export default function Page() {
  return (
    <main className="min-h-screen p-6 space-y-4">
      <h1 className="text-xl font-semibold">JRide /admin/livetrips</h1>
      <p className="text-sm text-gray-600">
        Temporary stub page to get the build passing. Realtime logic will be wired back in once
        deployment is stable.
      </p>

      <section className="rounded-2xl bg-white shadow p-4">
        <h2 className="font-semibold mb-2">Online Drivers</h2>
        {MOCK_DRIVERS.length === 0 ? (
          <p className="text-sm text-gray-500">No drivers yet.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {MOCK_DRIVERS.map((d) => (
              <li key={d.id}>
                {d.id} — {d.lat}, {d.lng} ({d.status})
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
