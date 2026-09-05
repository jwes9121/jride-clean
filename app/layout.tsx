import "./globals.css";
import "mapbox-gl/dist/mapbox-gl.css";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import AnalyticsCompletedTicketsVendorAttendance from "./components/AnalyticsCompletedTicketsVendorAttendance";
import AnalyticsFailedTickets from "./components/AnalyticsFailedTickets";
import PassengerSessionGuardian from "./components/PassengerSessionGuardian";
import TakeoutPassengerMobileAssist from "./components/TakeoutPassengerMobileAssist";
import TakeoutPassengerPinUX from "./components/TakeoutPassengerPinUX";
import TakeoutTrackingMilestoneAssist from "./components/TakeoutTrackingMilestoneAssist";
import VendorComplianceNotice from "./components/VendorComplianceNotice";
import VendorMenuEditorAssist from "./components/VendorMenuEditorAssist";
import VendorPortalDailyCompression from "./components/VendorPortalDailyCompression";
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
        <VendorComplianceNotice />
        <VendorPortalMobileChrome />
        <PassengerSessionGuardian />
        {children}
        <AnalyticsCompletedTicketsVendorAttendance />
        <AnalyticsFailedTickets />
        <TakeoutPassengerMobileAssist />
        <TakeoutPassengerPinUX />
        <TakeoutTrackingMilestoneAssist />
        <VendorPortalDailyCompression />
        <VendorMenuEditorAssist />
        <VendorPresenceHeartbeat />
      </body>
    </html>
  );
}
