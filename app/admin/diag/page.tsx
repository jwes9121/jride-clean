export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function Page() {
  const hasMapbox =
    !!process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN ||
    !!process.env.NEXT_PUBLIC_MAPBOX;
  const hasSupabase =
    !!process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !!process.env.SUPABASE_URL;

  return (
    <div className="p-6 space-y-2">
      <h1 className="text-xl font-bold">JRide /admin/diag</h1>
      <div className="px-3 py-2 rounded bg-gray-100">
        Tailwind test: this block should have padding.
      </div>
      <div>Mapbox token present: {String(hasMapbox)}</div>
      <div>Supabase URL present: {String(hasSupabase)}</div>
    </div>
  );
}
