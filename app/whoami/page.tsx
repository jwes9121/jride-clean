// app/whoami/page.tsx
import { auth } from "../../auth";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function WhoAmI() {
  const session = await auth();
  const u = session?.user;

  return (
    <main style={{ maxWidth: 900, margin: "24px auto", padding: 16 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 12 }}>
        🚀 WHOAMI (server session)
      </h1>

      {!u ? (
        <div style={{ lineHeight: 1.6 }}>
          <p>Not signed in.</p>
          <p>
            Go to{" "}
            <Link href="/auth/signin" style={{ textDecoration: "underline" }}>
              /auth/signin
            </Link>{" "}
            (don’t use <code>/api/auth/signin</code> directly — that causes
            <code> MissingCSRF</code>).
          </p>
        </div>
      ) : (
        <>
          <section
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              marginBottom: 16,
            }}
          >
            {/* use plain <img> so no next/image config needed */}
            {u.image ? (
              <img
                src={u.image}
                alt={u.name ?? "User"}
                width={56}
                height={56}
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: "50%",
                  border: "1px solid #ddd",
                }}
              />
            ) : (
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: "50%",
                  background: "#ddd",
                }}
              />
            )}
            <div>
              <div style={{ fontWeight: 600 }}>{u.name ?? "Unnamed"}</div>
              <div style={{ color: "#555" }}>{u.email}</div>
            </div>
          </section>

          <section
            style={{
              background: "#f9fafb",
              border: "1px solid #eee",
              borderRadius: 12,
              padding: 12,
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: 13,
              overflowX: "auto",
            }}
          >
            <div style={{ marginBottom: 8, fontWeight: 600 }}>
              Raw session JSON
            </div>
            <pre style={{ margin: 0 }}>
{JSON.stringify(session, null, 2)}
            </pre>
          </section>

          <div style={{ marginTop: 16 }}>
            <Link href="/dashboard" style={{ textDecoration: "underline" }}>
              Back to Dashboard
            </Link>
          </div>
        </>
      )}
    </main>
  );
}
