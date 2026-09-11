import "./errand-theme.css";
import type { ReactNode } from "react";
import ErrandRecoveryBanner from "./ErrandRecoveryBanner";
import ErrandPassengerExperience from "./ErrandPassengerExperience";
import ErrandConfirmProxyBridge from "./ErrandConfirmProxyBridge";

export default function ErrandsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="jride-errand">
      <ErrandPassengerExperience />
      <ErrandConfirmProxyBridge />
      <ErrandRecoveryBanner />
      {children}
    </div>
  );
}
