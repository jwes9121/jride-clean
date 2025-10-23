import { ReactNode } from "react";
import { auth } from "../../auth";
import { redirect } from "next/navigation";
import TopNav from "../components/TopNav";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AuthedLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  if (!session) redirect("/auth/signin");

  const u = session.user;

  return (
    <html lang="en">
      <body>
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
              <img
                src={u.image}
                alt={u?.name ?? ""}
                width={30}
                height={30}
                style={{ borderRadius: "50%", border: "1px solid #ddd" }}
              />
            ) : (
              <div style={{ width: 30, height: 30, borderRadius: "50%", background: "#ddd" }} />
            )}
            <span style={{ fontSize: 14 }}>{u?.name ?? u?.email}</span>
            <form action="/api/auth/signout" method="post">
              <button
                type="submit"
                style={{
                  fontSize: 13,
                  color: "#c00",
                  border: "1px solid #eee",
                  borderRadius: 6,
                  padding: "6px 10px",
                  cursor: "pointer",
                  background: "white",
                }}
              >
                Sign out
              </button>
            </form>
          </div>
        </header>

        <TopNav />

        <main style={{ maxWidth: 1000, margin: "0 auto", padding: "2rem 1rem" }}>
          {children}
        </main>
      </body>
    </html>
  );
}
