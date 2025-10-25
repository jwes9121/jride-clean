import React from "react";
import { auth } from "../../auth";
import TopNav from "./components/TopNav";

export default async function AuthedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
<<<<<<< HEAD
  const session = await auth();
=======
  const session = await auth(); // next-auth v5 auth() on server
>>>>>>> fix/auth-v5-clean

  return (
    <>
      <TopNav user={session?.user} />
      <main style={{ padding: "24px" }}>{children}</main>
    </>
  );
<<<<<<< HEAD
}
=======
}
>>>>>>> fix/auth-v5-clean
