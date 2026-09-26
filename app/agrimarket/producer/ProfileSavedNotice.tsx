"use client";
import { useEffect, useState } from "react";

export default function ProfileSavedNotice({ accountCode }: { accountCode: string }) {
  const [message, setMessage] = useState("");

  useEffect(() => {
    setMessage("");
    if (!accountCode) return;
    let timer: number | undefined;
    try {
      const key = `JRIDE_FARM_PROFILE_SAVED:${accountCode}`;
      const value = JSON.parse(sessionStorage.getItem(key) || "null");
      sessionStorage.removeItem(key);
      if (typeof value?.message === "string" && typeof value?.at === "number" && Date.now() - value.at < 60000) {
        setMessage(value.message);
        timer = window.setTimeout(() => setMessage(""), 7000);
      }
    } catch { /* Optional one-time success notice only. */ }
    return () => { if (timer) window.clearTimeout(timer); };
  }, [accountCode]);

  return message ? <div role="status" className="mb-4 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-950">{message}</div> : null;
}
