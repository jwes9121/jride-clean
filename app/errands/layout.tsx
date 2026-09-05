import type { ReactNode } from "react";
import ErrandRecoveryBanner from "./ErrandRecoveryBanner";
import ErrandPassengerExperience from "./ErrandPassengerExperience";

export default function ErrandsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <ErrandPassengerExperience />
      <ErrandRecoveryBanner />
      {children}
    </>
  );
}
