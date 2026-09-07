"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

function isNativePassengerHost(): boolean {
  if (typeof window === "undefined") return false;
  const deviceId =
    window.localStorage.getItem("jride_native_device_id") ||
    window.sessionStorage.getItem("jride_native_device_id") ||
    "";
  const userAgent = window.navigator.userAgent || "";
  return Boolean(deviceId.trim()) || /\bwv\b/i.test(userAgent) || /Android.*Version\/4\.0/i.test(userAgent);
}

export default function AgrimarketNativeShellCleanup() {
  const pathname = usePathname();

  useEffect(() => {
    if (pathname !== "/agrimarket") return;
    const body = document.body;
    if (!isNativePassengerHost()) return;
    body.setAttribute("data-jride-agrimarket-native", "1");
    return () => body.removeAttribute("data-jride-agrimarket-native");
  }, [pathname]);

  if (pathname !== "/agrimarket") return null;

  return (
    <style jsx global>{`
      body[data-jride-agrimarket-native="1"] main {
        padding-top: 0.5rem !important;
      }

      body[data-jride-agrimarket-native="1"] main > div > header,
      body[data-jride-agrimarket-native="1"] a[href="/agrimarket/farmer"] {
        display: none !important;
      }

      body[data-jride-agrimarket-native="1"] main div:has(> table),
      body[data-jride-agrimarket-native="1"] main table {
        display: none !important;
      }

      body[data-jride-agrimarket-native="1"] main aside:not(:has(input[type="number"])) {
        display: none !important;
      }

      @media (max-width: 640px) {
        main table {
          display: block;
          width: 100%;
          overflow-x: auto;
          white-space: nowrap;
          -webkit-overflow-scrolling: touch;
        }
      }
    `}</style>
  );
}
