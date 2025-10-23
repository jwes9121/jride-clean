import Link from "next/link";
import { auth } from "../../auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function RidesPage() {
  const session = await auth();
  if (!session) redirect("/auth/signin");
  const u = session.user;

  return (
    <>
      <header
        style={{
          borderBottom: "1px solid #eaeaea",
          background: "#fff",
          height: 60,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 1rem",
        }}
      >
        <div style={{ fontWeight: 700, fontSize: "1.1rem" }}>J-Ride</div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {u?.image ? (
            <img src={u.image} alt={u?.name ?? ""} width={30} height={30}
                 style={{ borderRadius: "50%", border: "1px solid #ddd" }} />
          ) : <div style={{ width: 30, height: 30, borderRadius: "50%", background: "#ddd" }} />}
          <span style={{ fontSize: 14 }}>{u?.name ?? u?.email}</span>
          <form action="/api/auth/signout" method="post">
            <button type="submit" style={{
              fontSize: 13, color: "#c00", border: "1px solid #eee",
              borderRadius: 6, padding: "6px 10px", cursor: "pointer", background: "white"
            }}>Sign out</button>
          </form>
        </div>
      </header>

      <nav style={{ borderBottom: "1px solid #eee", background: "#fafafa" }}>
        <div style={{ maxWidth: 1000, margin: "0 auto", display: "flex", gap: 16, padding: "10px 12px", fontSize: 14 }}>
          <Link href="/dashboard">Dashboard</Link>
          <Link href="/rides">Rides</Link>
          <Link href="/settings">Settings</Link>
        </div>
      </nav>

      <main style={{ maxWidth: 1000, margin: "0 auto", padding: "2rem 1rem" }}>
        <h1 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "1rem" }}>Rides</h1>
        <section style={{ border: "1px solid #eaeaea", borderRadius: 12, background: "#fafafa", padding: "1.5rem" }}>
          <p>Nothing here yet. This will list active & recent rides.</p>
        </section>
      </main>
    </>
  );
}
