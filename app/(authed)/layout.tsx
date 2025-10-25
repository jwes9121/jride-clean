import React from "react";
import { auth } from "../../auth";
import TopNav from "./components/TopNav";

export default async function AuthedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  return (
    <>
      <TopNav user={session?.user} />
      <main style={{ padding: "24px" }}>{children}</main>
    </>
  );
}
