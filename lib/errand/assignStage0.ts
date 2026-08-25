import {
  assignErrandStage0V2,
  type ErrandStage0AssignmentResultV2,
} from "@/lib/errand/assignStage0V2";

export type ErrandStage0AssignmentResult = ErrandStage0AssignmentResultV2;

export async function assignErrandStage0(input: {
  bookingId?: string | null;
  bookingCode?: string | null;
}): Promise<ErrandStage0AssignmentResult> {
  return assignErrandStage0V2(input);
}
