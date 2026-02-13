// lib/walletGuard.ts

import { createClient } from "@/utils/supabase/server"; // adjust if your helper is different

/**
 * Calls the DB guard function assert_driver_can_accept_new_job(driver_id).
 * Throws a readable error if the wallet is low or negative.
 */
export async function assertDriverCanAcceptNewJob(driverId: string) {
  const supabase = createClient();

  const { error } = await supabase.rpc("assert_driver_can_accept_new_job", {
    p_driver_id: driverId,
  });

  if (error) {
    // P0001 comes from the RAISE EXCEPTION in our SQL guard
    if (error.code === "P0001") {
      throw new Error(
        error.message ||
          "Driver wallet is below the minimum required. Please top up load wallet."
      );
    }

    // Any other error bubbles up
    throw error;
  }
}
