import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json({
    ok: true,
    disabled: true,
    reason: "Blind retry auto-assign disabled because it reassigns expired rides to the same excluded driver.",
  });
}
