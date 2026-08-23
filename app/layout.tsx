import "./globals.css";
import "mapbox-gl/dist/mapbox-gl.css";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import VendorMenuEditorAssist from "./components/VendorMenuEditorAssist";
import VendorPerformancePanel from "./components/VendorPerformancePanel";
import VendorPresenceHeartbeat from "./components/VendorPresenceHeartbeat";

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
        {children}
        <VendorMenuEditorAssist />
        <VendorPresenceHeartbeat />
        <VendorPerformancePanel />
      </body>
    </html>
  );
}
