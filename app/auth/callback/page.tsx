"use client";

import React, { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function AuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    const handleCallback = async () => {
      try {
        // If you need to read query params, use: const params = new URLSearchParams(window.location.search)
        // Do any verification here, then redirect:
        router.push("/"); // back to home (or wherever)
      } catch (err) {
        console.error("Unexpected callback error:", err);
      }
    };

    handleCallback();
  }, [router]);

  return <div className="p-6">Finishing sign-inâ€¦</div>;
}


