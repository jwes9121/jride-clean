import { redirect } from "next/navigation";

export default function AgrimarketCatalogReviewRedirect() {
  redirect("/admin/agrimarket/verified-farmers");
}
