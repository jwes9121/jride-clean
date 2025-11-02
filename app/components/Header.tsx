// app/components/Header.tsx
import Link from "next/link";
import { auth } from "@/configs/nextauth";

export default async function Header() {
  const session = await auth();
  const user = session?.user;

  return (
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
      <Link href="/dashboard" style={{ textDecoration: "none", color: "inherit" }}>
        <div style={{ fontWeight: 700, fontSize: "1.1rem" }}>J-Ride</div>
      </Link>

      {user ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {user.image && (
            <img
              src={user.image}
              alt={user.name ?? ""}
              width={30}
              height={30}
              style={{
                borderRadius: "50%",
                border: "1px solid #ddd",
              }}
            />
          )}
          <span style={{ fontSize: 14 }}>{user.name ?? user.email}</span>
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
      ) : (
        <Link
          href="/auth/signin"
          style={{
            fontSize: 14,
            border: "1px solid #eee",
            borderRadius: 6,
            padding: "6px 10px",
          }}
        >
          Sign in
        </Link>
      )}
    </header>
  );
}
