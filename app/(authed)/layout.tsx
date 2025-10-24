// app/(authed)/layout.tsx
import React from "react";
import { auth } from "@/app/auth";
import { redirect } from "next/navigation";
import TopNav from "../components/TopNav";

export default async function AuthedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session) redirect("/auth/signin");

  return (
    <>
      <TopNav user={session.user} />
      <main style={{ padding: "24px" }}>{children}</main>
    </>
  );
}
