import type { ReactNode } from "react";
import ErrandRecoveryBanner from "./ErrandRecoveryBanner";
import ErrandPassengerExperience from "./ErrandPassengerExperience";
import ErrandConfirmProxyBridge from "./ErrandConfirmProxyBridge";

export default function ErrandsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <ErrandPassengerExperience />
      <ErrandConfirmProxyBridge />
      <ErrandRecoveryBanner />
      {children}
    </>
  );
}
