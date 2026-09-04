import type { ReactNode } from "react";
import ErrandReferenceBanner from "./ErrandReferenceBanner";
import ErrandRecoveryBanner from "./ErrandRecoveryBanner";
import ErrandPassengerExperience from "./ErrandPassengerExperience";
import ErrandPassengerActiveBarV2 from "./ErrandPassengerActiveBarV2";

export default function ErrandsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <ErrandPassengerExperience />
      <ErrandReferenceBanner />
      <ErrandRecoveryBanner />
      {children}
      <ErrandPassengerActiveBarV2 />
    </>
  );
}
