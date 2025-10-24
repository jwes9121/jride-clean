import * as React from "react";
import { auth } from "../../auth";
import TopNav from "./TopNav";

export const dynamic = "force-dynamic"; // avoids caching the session in layout

type AuthedLayoutProps = {
  children: React.ReactNode;
};

export default async function AuthedLayout({ children }: AuthedLayoutProps) {
  // get the current session on the server
  const session = await auth();

  return (
    <div
      style={{
        minHeight: "100vh",
        backgroundColor: "#f5f5f5",
        color: "#111",
        display: "flex",
        flexDirection: "column",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <TopNav user={session?.user as any} />

      <main
        style={{
          flex: 1,
          padding: "24px",
        }}
      >
        {children}
      </main>
    </div>
  );
}
