"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function ErrandRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/errands");
  }, [router]);
  return null;
}