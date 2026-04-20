import { NextRequest } from "next/server";
import { GET as getRideRating } from "../../rides/rate/route";

export async function GET(req: NextRequest) {
  return getRideRating(req);
}
