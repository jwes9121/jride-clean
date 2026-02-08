import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;

export default function VendorLanding(props: { searchParams?: SP }) {
  const sp = props?.searchParams || {};
  const raw = sp["vendor_id"];
  const vendorId = typeof raw === "string" ? raw.trim() : "";
  if (vendorId) {
    redirect(`/vendor-orders?vendor_id=${encodeURIComponent(vendorId)}`);
  }
  redirect("/vendor-orders");
}
