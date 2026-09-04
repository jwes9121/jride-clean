import type { ReactNode } from "react";
import ErrandReferenceBanner from "./ErrandReferenceBanner";
import ErrandRecoveryBanner from "./ErrandRecoveryBanner";
import ErrandPassengerExperience from "./ErrandPassengerExperience";
import ErrandStickyFare from "./ErrandStickyFare";

export default function ErrandsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <ErrandPassengerExperience />
      <ErrandReferenceBanner />
      <ErrandRecoveryBanner />
      {children}
      <ErrandStickyFare />
    </>
  );
}
