"use client";

import { Button } from "@/components/ui/button";

type DispatchActionsProps = {
  // We keep this loose for now to avoid type issues.
  selectedBooking: any;
};

export function DispatchActions({ selectedBooking }: DispatchActionsProps) {
  if (!selectedBooking) {
    return (
      <div className="text-xs text-slate-400">
        No booking selected.
      </div>
    );
  }

  // Placeholder actions – we can wire these to real endpoints later.
  return (
    <div className="flex flex-wrap gap-1">
      <Button size="sm" variant="outline">
        Assign
      </Button>
      <Button size="sm" variant="outline">
        On the way
      </Button>
      <Button size="sm" variant="outline">
        Start trip
      </Button>
      <Button size="sm" variant="outline">
        Drop off
      </Button>
    </div>
  );
}

// Also export default so either import style works.
export default DispatchActions;

