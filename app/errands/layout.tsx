import type { ReactNode } from "react";
import ErrandReferenceBanner from "./ErrandReferenceBanner";

export default function ErrandsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <ErrandReferenceBanner />
      {children}
    </>
  );
}
