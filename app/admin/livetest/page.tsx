// app/admin/livetest/page.tsx
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function Page() {
  return (
    <main style={{ padding: 20 }}>
      <h1>JRide /admin/livetest</h1>
      <p>This is a minimal page to verify the route works.</p>
    </main>
  );
}
