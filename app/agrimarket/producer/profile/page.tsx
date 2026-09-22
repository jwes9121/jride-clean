"use client";

import FarmerPickupMap, {
  emptyFarmerPin,
  type FarmerPickupPin,
} from "@/components/agrimarket/FarmerPickupMap";
import { farmerSessionHeaders } from "@/lib/agrimarket/farmerSessionClient";
import { useEffect, useRef, useState } from "react";
import {
  FarmerFeedback,
  FarmerLogin,
  FarmerUnavailable,
  FarmerWorkspace,
} from "../FarmerWorkspace";
import { useFarmerSession } from "../useFarmerSession";
import styles from "../farmer.module.css";

type Profile = {
  contact_name: string;
  contact_phone: string;
  town: string;
  barangay: string;
  vendor_name: string;
  pickup_label: string;
  pickup_lat: number | null;
  pickup_lng: number | null;
  pickup_motorcycle_accessible: boolean;
  pickup_tricycle_accessible: boolean;
  pickup_roadside_handoff_required: boolean;
  pickup_driver_directions: string;
  pickup_verified: boolean;
  profile_complete: boolean;
  accepting_orders: boolean;
  store_open: boolean;
};

const blank = {
  contact_name: "",
  contact_phone: "",
  barangay: "",
  vendor_name: "",
  pickup_motorcycle_accessible: false,
  pickup_tricycle_accessible: false,
  pickup_roadside_handoff_required: false,
  pickup_driver_directions: "",
};

export default function AgrimarketProducerProfilePage() {
  const {
    accessCode,
    setAccessCode,
    pin: loginPin,
    setPin: setLoginPin,
    sessionCode,
    restoring,
    authError,
    signIn,
    signOut,
    invalidate,
  } = useFarmerSession();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [form, setForm] = useState(blank);
  const [pickup, setPickup] = useState<FarmerPickupPin>(emptyFarmerPin);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [disabled, setDisabled] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const flight = useRef(false);

  useEffect(() => {
    if (sessionCode) void loadProfile();
    else {
      setProfile(null);
      setForm(blank);
      setPickup(emptyFarmerPin());
    }
  }, [sessionCode]);

  async function loadProfile() {
    if (!sessionCode || flight.current) return;
    flight.current = true;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/agrimarket/producer/profile", {
        cache: "no-store",
        headers: farmerSessionHeaders(sessionCode),
        signal: AbortSignal.timeout(10000),
      });
      const body = await response.json().catch(() => ({}));
      if (["AGRIMARKET_DISABLED", "AGRIMARKET_FARMER_PORTAL_DISABLED"].includes(body?.error)) {
        setDisabled(true);
        return;
      }
      if (response.status === 401 || response.status === 403) {
        invalidate();
        throw new Error(body?.message || "Sign in again to open your farm profile.");
      }
      if (!response.ok || !body?.profile) {
        throw new Error(body?.message || "Your farm profile could not be loaded.");
      }

      const next: Profile = body.profile;
      setProfile(next);
      setForm({
        contact_name: next.contact_name || "",
        contact_phone: next.contact_phone || "",
        barangay: next.barangay || "",
        vendor_name: next.vendor_name || "",
        pickup_motorcycle_accessible: next.pickup_motorcycle_accessible === true,
        pickup_tricycle_accessible: next.pickup_tricycle_accessible === true,
        pickup_roadside_handoff_required: next.pickup_roadside_handoff_required === true,
        pickup_driver_directions: next.pickup_driver_directions || "",
      });
      setPickup(
        next.pickup_verified && next.pickup_lat != null && next.pickup_lng != null
          ? {
              lat: next.pickup_lat,
              lng: next.pickup_lng,
              resolved_town: next.town,
              resolved_barangay: next.barangay || null,
              resolved_label: next.pickup_label || null,
              launch_eligible: true,
              resolving: false,
            }
          : emptyFarmerPin()
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Your farm profile could not be loaded.");
    } finally {
      flight.current = false;
      setLoading(false);
    }
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!sessionCode || saving) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/agrimarket/producer/profile", {
        method: "POST",
        headers: farmerSessionHeaders(sessionCode, true),
        body: JSON.stringify({
          ...form,
          pickup_lat: pickup.lat,
          pickup_lng: pickup.lng,
        }),
        signal: AbortSignal.timeout(15000),
      });
      const body = await response.json().catch(() => ({}));
      if (response.status === 401 || response.status === 403) {
        invalidate();
        throw new Error(body?.message || "Sign in again before saving your farm profile.");
      }
      if (!response.ok || !body?.profile) {
        throw new Error(body?.message || "Your farm profile could not be saved.");
      }
      setProfile(body.profile);
      setMessage(body.message || "Farm profile saved.");
      window.dispatchEvent(new Event("agrimarket-store-updated"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Your farm profile could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  if (disabled) return <FarmerUnavailable section="profile" />;

  if (!sessionCode) {
    return (
      <FarmerLogin
        section="profile"
        accessCode={accessCode}
        pin={loginPin}
        onCodeChange={setAccessCode}
        onPinChange={setLoginPin}
        onSubmit={() => {
          setError("");
          void signIn();
        }}
        loading={loading || restoring}
        error={error || authError}
      />
    );
  }

  return (
    <FarmerWorkspace
      section="profile"
      accountCode={sessionCode}
      onSignOut={() => void signOut()}
      onRefresh={() => void loadProfile()}
      loading={loading || restoring}
    >
      <section className={styles.createPanel}>
        <div className={styles.sectionHeading}>
          <div>
            <span className={styles.eyebrow}>YOUR FARM DETAILS</span>
            <h1>{profile?.profile_complete ? "Farm profile" : "Complete your farm profile"}</h1>
            <p>
              JRide uses these details for farmer verification, product pickup and driver access.
              Your private contact and exact pickup point are not shown as public store details.
            </p>
          </div>
        </div>

        {profile && (
          <div className={profile.profile_complete ? "rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900" : "rounded-xl bg-amber-50 p-3 text-sm text-amber-950"}>
            {profile.profile_complete
              ? profile.accepting_orders
                ? "Profile complete and JRide readiness approved."
                : "Profile complete. JRide readiness approval is still required before customer orders are enabled."
              : "Complete the required fields below. Customer orders remain disabled while setup is incomplete."}
          </div>
        )}

        <FarmerFeedback error={error || authError} message={message} />

        {profile && (
          <form onSubmit={save} className="mt-4 space-y-5">
            <fieldset className={styles.formSection}>
              <legend><span>01</span> Farmer and farm</legend>
              <div className={styles.formGrid}>
                <label className="text-sm font-semibold">
                  Farmer full name
                  <input
                    required
                    value={form.contact_name}
                    onChange={(event) => setForm({ ...form, contact_name: event.target.value })}
                    className="mt-1 w-full rounded-xl border px-3 py-3"
                    placeholder="Full name"
                  />
                </label>
                <label className="text-sm font-semibold">
                  Mobile number
                  <input
                    required
                    inputMode="tel"
                    value={form.contact_phone}
                    onChange={(event) => setForm({ ...form, contact_phone: event.target.value })}
                    className="mt-1 w-full rounded-xl border px-3 py-3"
                    placeholder="09XXXXXXXXX"
                  />
                </label>
                <label className="text-sm font-semibold">
                  Municipality
                  <input
                    readOnly
                    value={profile.town}
                    className="mt-1 w-full rounded-xl border bg-slate-50 px-3 py-3"
                  />
                </label>
                <label className="text-sm font-semibold">
                  Barangay
                  <input
                    required
                    value={form.barangay}
                    onChange={(event) => setForm({ ...form, barangay: event.target.value })}
                    className="mt-1 w-full rounded-xl border px-3 py-3"
                    placeholder="Barangay"
                  />
                </label>
                <label className="text-sm font-semibold sm:col-span-2">
                  Farm / store name
                  <input
                    required
                    minLength={2}
                    maxLength={60}
                    value={form.vendor_name}
                    onChange={(event) => setForm({ ...form, vendor_name: event.target.value })}
                    className="mt-1 w-full rounded-xl border px-3 py-3"
                    placeholder="Name customers will see"
                  />
                </label>
              </div>
            </fieldset>

            <fieldset className={styles.formSection}>
              <legend><span>02</span> Actual pickup point</legend>
              <FarmerPickupMap selectedTown={profile.town} value={pickup} onChange={setPickup} farmerCode={sessionCode} />
            </fieldset>

            <fieldset className={styles.formSection}>
              <legend><span>03</span> Driver access</legend>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="flex items-start gap-3 rounded-xl border bg-white p-3">
                  <input
                    type="checkbox"
                    checked={form.pickup_motorcycle_accessible}
                    onChange={(event) => setForm({ ...form, pickup_motorcycle_accessible: event.target.checked })}
                  />
                  <span><strong>Motorcycle accessible</strong><br /><span className="text-xs text-slate-600">A motorcycle can safely reach the pickup point.</span></span>
                </label>
                <label className="flex items-start gap-3 rounded-xl border bg-white p-3">
                  <input
                    type="checkbox"
                    checked={form.pickup_tricycle_accessible}
                    onChange={(event) => setForm({ ...form, pickup_tricycle_accessible: event.target.checked })}
                  />
                  <span><strong>Tricycle accessible</strong><br /><span className="text-xs text-slate-600">A tricycle can safely reach the pickup point.</span></span>
                </label>
                <label className="flex items-start gap-3 rounded-xl border bg-white p-3 md:col-span-2">
                  <input
                    type="checkbox"
                    checked={form.pickup_roadside_handoff_required}
                    onChange={(event) => setForm({ ...form, pickup_roadside_handoff_required: event.target.checked })}
                  />
                  <span><strong>Roadside handoff required</strong><br /><span className="text-xs text-slate-600">The driver should meet the farmer at an accessible roadside point.</span></span>
                </label>
                <label className="text-sm font-semibold md:col-span-2">
                  Driver directions / landmark
                  <textarea
                    required
                    minLength={5}
                    maxLength={1000}
                    value={form.pickup_driver_directions}
                    onChange={(event) => setForm({ ...form, pickup_driver_directions: event.target.value })}
                    className="mt-1 min-h-24 w-full rounded-xl border px-3 py-3"
                    placeholder="Example: Meet at the roadside beside the barangay hall."
                  />
                </label>
              </div>
            </fieldset>

            <div className="rounded-xl border bg-white p-3 text-sm">
              {profile.accepting_orders ? (
                <>
                  <p>Changing only the farm / store name or driver directions keeps your approval and current Open / Closed setting.</p>
                  <p className="mt-2 rounded-lg bg-amber-50 p-3 text-amber-950">
                    <strong>Review required:</strong> Changing the farmer name, mobile number, barangay, pickup pin, or vehicle-access / roadside settings will close the store and pause new orders until JRide approves readiness again. Your products remain saved.
                  </p>
                </>
              ) : (
                "Saving this profile does not automatically open the store. JRide must still approve readiness before customer orders can be received."
              )}
            </div>

            <button
              type="submit"
              disabled={
                saving ||
                pickup.resolving ||
                !pickup.launch_eligible ||
                pickup.resolved_town !== profile.town ||
                (!form.pickup_motorcycle_accessible && !form.pickup_tricycle_accessible) ||
                form.pickup_driver_directions.trim().length < 5
              }
              className={styles.primaryButton}
            >
              {saving ? "Saving farm profile..." : "Save farm profile"}
            </button>
          </form>
        )}

        {!profile && !loading && (
          <button type="button" onClick={() => void loadProfile()} className={styles.secondaryButton}>
            Retry
          </button>
        )}
      </section>
    </FarmerWorkspace>
  );
}
