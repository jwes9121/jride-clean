// app/components/Header.tsx
import Link from "next/link";
import { auth } from "../../auth";

export default async function Header() {
  const session = await auth();
  const u = session?.user;

  return (
    <header style={{ borderBottom: "1px solid #eee", background: "#fff" }}>
      <div style={{
        maxWidth: 1000, margin: "0 auto", height: 56, display: "flex",
        alignItems: "center", justifyContent: "space-between", padding: "0 16px"
      }}>
        {/* J-Ride logo/title */}
        <Link href="/dashboard" style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none", color: "inherit" }}>
          <div style={{
            width: 28, height: 28, background: "#000", color: "#fff",
            borderRadius: 12, display: "flex", alignItems: "center",
            justifyContent: "center", fontSize: 12, fontWeight: 700
          }}>JR</div>
          <div style={{ fontWeight: 600 }}>J-Ride</div>
        </Link>

        {/* Right side */}
        {u ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {u.image
              ? <img src={u.image} alt={u.name ?? "User"} width={28} height={28}
                     style={{ width: 28, height: 28, borderRadius: "50%", border: "1px solid #ddd" }}/>
              : <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#ddd" }}/>}
            <span style={{ fontSize: 14 }}>{u.name ?? u.email}</span>
            <form action="/api/auth/signout" method="post">
              <button type="submit"
                      style={{ fontSize: 13, color: "#c00", border: "1px solid #eee", borderRadius: 6, padding: "6px 10px" }}>
                Sign out
              </button>
            </form>
          </div>
        ) : (
          <Link href="/auth/signin" style={{ fontSize: 14, border: "1px solid #eee", borderRadius: 6, padding: "6px 10px" }}>
            Sign in
          </Link>
        )}
      </div>
    </header>
  );
}
