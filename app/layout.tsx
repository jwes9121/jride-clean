import "./globals.css";
import "mapbox-gl/dist/mapbox-gl.css";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import VendorMenuEditorAssist from "./components/VendorMenuEditorAssist";
import VendorPortalMobileChrome from "./components/VendorPortalMobileChrome";
import VendorPresenceHeartbeat from "./components/VendorPresenceHeartbeat";
import VendorHoursGate from "./components/VendorHoursGate";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "JRide",
  description: "JRide app",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <VendorHoursGate />
        <VendorPortalMobileChrome />
        {children}
        <VendorMenuEditorAssist />
        <VendorPresenceHeartbeat />
      </body>
    </html>
  );
}
