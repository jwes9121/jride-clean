// app/plain/page.tsx
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function Plain() {
  return (
    <main style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h1>PLAIN MARKER ✅</h1>
      <p>If you see this, the new build is served and no layout is wrapping this page.</p>
    </main>
  );
}
