import type { ReactNode } from "react";
import ErrandReferenceBanner from "./ErrandReferenceBanner";
import ErrandRecoveryBanner from "./ErrandRecoveryBanner";

export default function ErrandsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <ErrandReferenceBanner />
      <ErrandRecoveryBanner />
      {children}
    </>
  );
}
