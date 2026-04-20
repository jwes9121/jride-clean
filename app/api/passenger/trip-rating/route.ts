import { NextRequest } from "next/server";
import { POST as postRideRating } from "../../rides/rate/route";

export async function POST(req: NextRequest) {
  return postRideRating(req);
}
