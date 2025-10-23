// app/whoami/page.tsx
import { auth } from "../../auth";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function WhoAmI() {
  const session = await auth();
  const u = session?.user;

  return (
    <main style={{ maxWidth: 800, margin: "24px auto", padding: 16 }}>
      <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 12 }}>
        Who am I (server session)
      </h1>

      {!u ? (
        <div>
          <p>Not signed in.</p>
          <p><Link href="/auth/signin">Go to Sign in</Link></p>
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {/* plain <img> avoids next/image config */}
          {u.image ? (
            <img
              src={u.image}
              alt={u.name ?? "User"}
              width={56}
              height={56}
              style={{ width: 56, height: 56, borderRadius: "50%", border: "1px solid #ddd" }}
            />
          ) : (
            <div style={{ width: 56, height: 56, borderRadius: "50%", background: "#ddd" }} />
          )}
          <div>
            <div style={{ fontWeight: 600 }}>{u.name ?? "Unnamed"}</div>
            <div style={{ color: "#555" }}>{u.email}</div>
            <div style={{ marginTop: 8 }}>
              <Link href="/dashboard">Back to Dashboard</Link>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
