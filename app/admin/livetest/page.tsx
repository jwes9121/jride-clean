"use client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function Page() {
  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold">JRide /admin/livetest</h1>
      <p>This is a minimal page to verify the route works.</p>
    </main>
  );
}
