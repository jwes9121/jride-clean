"use client";

import FarmerPickupMap, {
  emptyFarmerPin,
  type FarmerPickupPin,
} from "@/components/agrimarket/FarmerPickupMap";
import { farmerSessionHeaders } from "@/lib/agrimarket/farmerSessionClient";
import { AGRIMARKET_ACTIVE_TOWNS, agrimarketBarangays, canonicalAgrimarketBarangay } from "@/lib/agrimarket/farmer-towns";
import { driverDirectionsError } from "@/lib/agrimarket/farmer-profile-validation";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
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
  town_editable: boolean;
  barangay: string;
  vendor_name: string;
  vendor_name_locked: boolean;
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
  town: "",
  barangay: "",
  vendor_name: "",
  pickup_motorcycle_accessible: false,
  pickup_tricycle_accessible: false,
  pickup_roadside_handoff_required: false,
  pickup_driver_directions: "",
};

export default function AgrimarketProducerProfilePage() {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [confirmingName, setConfirmingName] = useState(false);
  const saveFlight = useRef(false);
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
  const [profileCheck, setProfileCheck] = useState<{
    checking: boolean;
    phoneAvailable: boolean | null;
    storeNameAvailable: boolean | null;
    error: string;
  }>({ checking: false, phoneAvailable: null, storeNameAvailable: null, error: "" });
  const profileCheckGeneration = useRef(0);
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
    if (!sessionCode || flight.current || saveFlight.current) return;
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
      setEditing(!next.profile_complete);
      setConfirmingName(false);
      setProfileCheck({ checking: false, phoneAvailable: null, storeNameAvailable: null, error: "" });
      setForm({
        contact_name: next.contact_name || "",
        contact_phone: next.contact_phone || "",
        town: next.town || "",
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

  async function checkProfileIdentity(showError: boolean): Promise<boolean> {
    if (!sessionCode) return false;
    const phoneDigits = form.contact_phone.replace(/\D/g, "");
    const vendorName = form.vendor_name.trim().replace(/\s+/g, " ");
    if (phoneDigits.length < 10 || !form.town) return false;

    const generation = ++profileCheckGeneration.current;
    setProfileCheck((current) => ({ ...current, checking: true, error: "" }));
    try {
      const params = new URLSearchParams({
        town: form.town,
        phone: form.contact_phone,
        vendor_name: vendorName,
      });
      const response = await fetch(`/api/agrimarket/producer/profile-check?${params}`, {
        cache: "no-store",
        headers: farmerSessionHeaders(sessionCode),
        signal: AbortSignal.timeout(8000),
      });
      const body = await response.json().catch(() => ({}));
      if (response.status === 401 || response.status === 403) {
        invalidate();
        throw new Error(body?.message || "Sign in again to check your farmer details.");
      }
      if (!response.ok || body?.ok !== true) {
        throw new Error(body?.message || "JRide could not check the mobile number and farm/store name.");
      }
      if (generation !== profileCheckGeneration.current) return false;
      const phoneAvailable = body.phone_available === true;
      const storeNameAvailable = body.store_name_available == null ? null : body.store_name_available === true;
      setProfileCheck({ checking: false, phoneAvailable, storeNameAvailable, error: "" });
      setError((current) => {
        if (
          current.includes("mobile number is already registered") ||
          current.includes("farm/store name already exists")
        ) return "";
        return current;
      });

      if (showError && !phoneAvailable) {
        setError("This mobile number is already registered to another AgriMarket farmer account. Use a different number.");
      } else if (showError && !profile?.vendor_name_locked && vendorName.length < 2) {
        setError("Enter a farm or store name between 2 and 60 characters.");
      } else if (showError && !profile?.vendor_name_locked && storeNameAvailable !== true) {
        setError(`This farm/store name already exists in ${form.town}. Choose a different name.`);
      }
      return phoneAvailable && (
        profile?.vendor_name_locked === true ||
        (vendorName.length >= 2 && storeNameAvailable === true)
      );
    } catch (cause) {
      if (generation !== profileCheckGeneration.current) return false;
      const message = cause instanceof Error ? cause.message : "JRide could not check your farmer details.";
      setProfileCheck({ checking: false, phoneAvailable: null, storeNameAvailable: null, error: message });
      if (showError) setError(message);
      return false;
    }
  }

  useEffect(() => {
    if (!editing || !sessionCode) return;
    const phoneDigits = form.contact_phone.replace(/\D/g, "");
    if (phoneDigits.length < 10 || !form.town) {
      setProfileCheck({ checking: false, phoneAvailable: null, storeNameAvailable: null, error: "" });
      return;
    }
    const timer = window.setTimeout(() => { void checkProfileIdentity(false); }, 450);
    return () => window.clearTimeout(timer);
    // Identity checks intentionally follow the editable farmer fields.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, sessionCode, form.contact_phone, form.town, form.vendor_name]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!sessionCode || saving || saveFlight.current || flight.current) return;
    setError("");
    if (!(await checkProfileIdentity(true))) return;
    if (!profile?.vendor_name_locked) { setConfirmingName(true); return; }
    await persistProfile(false);
  }

  async function persistProfile(confirmName: boolean) {
    if (!sessionCode || saveFlight.current || flight.current) return;
    saveFlight.current = true;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/agrimarket/producer/profile", {
        method: "POST",
        headers: farmerSessionHeaders(sessionCode, true),
        body: JSON.stringify({
          ...form,
          confirm_vendor_name: confirmName,
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
      if (body.profile.vendor_name_locked !== true) {
        throw new Error("The saved name lock could not be confirmed. Refresh your farm profile before continuing.");
      }
      setProfile(body.profile);
      setEditing(false);
      setConfirmingName(false);
      setMessage(body.message || "Farm profile saved.");
      try {
        sessionStorage.setItem(`JRIDE_FARM_PROFILE_SAVED:${sessionCode}`, JSON.stringify({
          message: body.message || "Farm profile saved.",
          at: Date.now(),
        }));
      } catch { /* Saving succeeds even when the optional dashboard notice cannot be stored. */ }
      router.replace("/agrimarket/producer");
      window.dispatchEvent(new Event("agrimarket-store-updated"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Your farm profile could not be saved.");
    } finally {
      saveFlight.current = false;
      setSaving(false);
    }
  }

  const barangays = agrimarketBarangays(form.town);
  const legacyBarangay = form.barangay && !barangays.includes(form.barangay) ? form.barangay : "";

  const directionsError = profile
    ? driverDirectionsError({
        directions: form.pickup_driver_directions,
        contactName: form.contact_name,
        vendorName: form.vendor_name,
        town: form.town,
        barangay: form.barangay,
      })
    : null;

  const saveRequirement = !profile || !editing
    ? ""
    : profileCheck.phoneAvailable === false
      ? "Use a mobile number that is not already registered to another AgriMarket farmer."
      : !profile.vendor_name_locked && profileCheck.storeNameAvailable === false
        ? `Choose a farm/store name that is not already used in ${form.town}.`
        : pickup.resolving
      ? "Wait while JRide verifies the pickup municipality."
      : pickup.lat == null || pickup.lng == null || !pickup.launch_eligible
        ? "Place and verify the actual pickup point on the map."
        : pickup.resolved_town !== form.town
          ? `The pickup pin must be inside ${form.town}.`
          : !form.pickup_motorcycle_accessible && !form.pickup_tricycle_accessible
            ? "Choose at least one vehicle that can reach the pickup point."
            : directionsError
              ? directionsError
              : "";

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

        {profile && !profile.profile_complete && (
          <div className={styles.setupProgress} aria-label="Farm setup steps">
            <span><strong>1</strong> Farmer details</span>
            <span><strong>2</strong> Pickup point</span>
            <span><strong>3</strong> Driver access</span>
          </div>
        )}

        {profile && (
          <div className={profile.profile_complete ? "rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900" : "rounded-xl bg-amber-50 p-3 text-sm text-amber-950"}>
            {profile.profile_complete
              ? profile.accepting_orders
                ? "Profile complete and JRide readiness approved."
                : "Profile complete. JRide readiness approval is still required before customer orders are enabled."
              : profile.accepting_orders
                ? "Your profile needs completion. Current order approval is shown above; saving sensitive changes may require review."
                : "Complete the required fields below. Customer orders remain disabled while setup is incomplete."}
          </div>
        )}

        <FarmerFeedback error={error || authError} message={message} />

        {profile && !editing && (
          <section aria-label="Saved farm profile" className="mt-4 space-y-4">
            <h2 className="text-xl font-bold">{profile.vendor_name}</h2>
            <p className="rounded-xl bg-slate-50 p-3 text-sm">{profile.vendor_name_locked
              ? "Farm/store name locked. You cannot change this name in the app. Contact JRide for a correction."
              : "This farm/store name has not been confirmed yet. Review it carefully before confirming."}</p>
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div><dt className="font-semibold">Farmer</dt><dd>{profile.contact_name}</dd></div>
              <div><dt className="font-semibold">Mobile number</dt><dd>{profile.contact_phone}</dd></div>
              <div><dt className="font-semibold">Municipality / barangay</dt><dd>{profile.town} / {profile.barangay}</dd></div>
              <div><dt className="font-semibold">Pickup point</dt><dd>{profile.pickup_label}</dd></div>
              <div><dt className="font-semibold">Driver directions</dt><dd>{profile.pickup_driver_directions}</dd></div>
            </dl>
            <div className="flex flex-wrap gap-3">
              <button type="button" className={styles.secondaryButton} onClick={() => setEditing(true)}>
                {profile.vendor_name_locked ? "Update contact / pickup details" : "Review and confirm farm/store name"}
              </button>
              <Link className={styles.primaryButton} href="/agrimarket/producer">Back to my farm</Link>
            </div>
          </section>
        )}
        {profile && editing && confirmingName && (
          <section aria-label="Confirm farm name" className="mt-4 space-y-4 rounded-xl border p-4">
            <h2 className="text-xl font-bold">Confirm your farm/store name</h2>
            <p className="break-words text-xl font-semibold">{form.vendor_name.trim().replace(/\s+/g, " ")}</p>
            <p>Check the spelling carefully. Once saved, you cannot change this name in the app.</p>
            <p className="text-sm">Your name is locked only after the complete profile saves successfully.</p>
            <div className="flex flex-wrap gap-3">
              <button type="button" disabled={saving} className={styles.secondaryButton} onClick={() => setConfirmingName(false)}>Go back</button>
              <button type="button" disabled={saving} className={styles.primaryButton} onClick={() => void persistProfile(true)}>{saving ? "Saving..." : "Confirm and save"}</button>
            </div>
          </section>
        )}
        {profile && editing && !confirmingName && (
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
                    onChange={(event) => {
                      profileCheckGeneration.current += 1;
                      setProfileCheck({ checking: false, phoneAvailable: null, storeNameAvailable: null, error: "" });
                      setForm({ ...form, contact_phone: event.target.value });
                      setError("");
                    }}
                    className="mt-1 w-full rounded-xl border px-3 py-3"
                    placeholder="09XXXXXXXXX"
                  />
                  {profileCheck.checking && <span className={styles.fieldHint}>Checking number...</span>}
                  {!profileCheck.checking && profileCheck.phoneAvailable === false && <span className="text-xs font-normal text-red-700">Already registered to another AgriMarket farmer.</span>}
                  {!profileCheck.checking && profileCheck.phoneAvailable === true && <span className="text-xs font-normal text-emerald-700">Mobile number is available for this account.</span>}
                </label>
                <label className="text-sm font-semibold">
                  Municipality
                  {profile.town_editable ? (
                    <>
                      <select
                        required
                        value={form.town}
                        onChange={(event) => {
                          profileCheckGeneration.current += 1;
                          setProfileCheck({ checking: false, phoneAvailable: null, storeNameAvailable: null, error: "" });
                          setForm({ ...form, town: event.target.value, barangay: "" });
                          setPickup(emptyFarmerPin());
                          setError("");
                        }}
                        className="mt-1 w-full rounded-xl border px-3 py-3"
                      >
                        {AGRIMARKET_ACTIVE_TOWNS.map((town) => <option key={town} value={town}>{town}</option>)}
                      </select>
                      <span className={styles.fieldHint}>Choose the municipality of the actual pickup point.</span>
                    </>
                  ) : (
                    <>
                      <input
                        readOnly
                        value={profile.town}
                        className="mt-1 w-full rounded-xl border bg-slate-50 px-3 py-3"
                      />
                      <span className={styles.fieldHint}>Municipality is locked after setup. Contact JRide for a correction.</span>
                    </>
                  )}
                </label>
                <label className="text-sm font-semibold">
                  Barangay
                  <select
                    required
                    value={form.barangay}
                    onChange={(event) => setForm({ ...form, barangay: event.target.value })}
                    className="mt-1 w-full rounded-xl border bg-white px-3 py-3"
                  >
                    <option value="">Select barangay</option>
                    {legacyBarangay && <option value={legacyBarangay}>{legacyBarangay} - choose official barangay</option>}
                    {barangays.map((barangay) => <option key={barangay} value={barangay}>{barangay}</option>)}
                  </select>
                </label>
                <label className="text-sm font-semibold sm:col-span-2">
                  Farm / store name
                  <input
                    required
                    minLength={2}
                    maxLength={60}
                    readOnly={profile.vendor_name_locked}
                    value={form.vendor_name}
                    onChange={(event) => {
                      profileCheckGeneration.current += 1;
                      setProfileCheck((current) => ({ ...current, storeNameAvailable: null, error: "" }));
                      setForm({ ...form, vendor_name: event.target.value });
                      setError("");
                    }}
                    className="mt-1 w-full rounded-xl border px-3 py-3"
                    placeholder="Name customers will see"
                  />
                  {!profile.vendor_name_locked && !profileCheck.checking && profileCheck.storeNameAvailable === false && <span className="text-xs font-normal text-red-700">This name already exists in {form.town}. Choose a different name.</span>}
                  {!profile.vendor_name_locked && !profileCheck.checking && profileCheck.storeNameAvailable === true && <span className="text-xs font-normal text-emerald-700">This name is available in {form.town}.</span>}
                  <span className="mt-2 block rounded-lg bg-amber-50 p-3 text-sm font-normal text-amber-950">
                    {profile.vendor_name_locked
                      ? "This confirmed name is locked. Contact JRide for a correction."
                      : "Choose carefully. After you confirm this name, only JRide can correct it."}
                  </span>
                </label>
              </div>
            </fieldset>

            <fieldset className={styles.formSection}>
              <legend><span>02</span> Actual pickup point</legend>
              <FarmerPickupMap selectedTown={form.town} value={pickup} onChange={(next) => {
                setPickup(next);
                const resolvedBarangay = next.resolved_barangay
                  ? canonicalAgrimarketBarangay(form.town, next.resolved_barangay)
                  : null;
                if (resolvedBarangay) setForm((current) => ({ ...current, barangay: resolvedBarangay }));
              }} farmerCode={sessionCode} />
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
                    minLength={8}
                    maxLength={1000}
                    value={form.pickup_driver_directions}
                    onChange={(event) => setForm({ ...form, pickup_driver_directions: event.target.value })}
                    className="mt-1 min-h-24 w-full rounded-xl border px-3 py-3"
                    placeholder="Example: Blue gate beside the barangay hall, along the concrete road."
                  />
                  <span className={styles.fieldHint}>Give a landmark, road detail, gate, or exact meeting point. Do not enter only the farm/store name.</span>
                </label>
              </div>
            </fieldset>

            <div className="rounded-xl border bg-white p-3 text-sm">
              {profile.accepting_orders ? (
                <>
                  <p>Changing only driver directions keeps your approval and current Open / Closed setting. Your confirmed farm/store name cannot be changed here.</p>
                  <p className="mt-2 rounded-lg bg-amber-50 p-3 text-amber-950">
                    <strong>Review required:</strong> Changing the farmer name, mobile number, barangay, pickup pin, or vehicle-access / roadside settings will close the store and pause new orders until JRide approves readiness again. Your products remain saved.
                  </p>
                </>
              ) : (
                "Saving this profile does not automatically open the store. JRide must still approve readiness before customer orders can be received."
              )}
            </div>

            {saveRequirement && <p className={styles.setupRequirement} role="status">{saveRequirement}</p>}
            <div className={styles.formActions}>
              {profile.profile_complete && <button type="button" disabled={saving} className={styles.secondaryButton} onClick={() => void loadProfile()}>Cancel editing</button>}
            <button
              type="submit"
              disabled={
                saving || loading ||
                pickup.resolving ||
                !pickup.launch_eligible ||
                pickup.resolved_town !== form.town ||
                (!form.pickup_motorcycle_accessible && !form.pickup_tricycle_accessible) ||
                Boolean(directionsError) ||
                profileCheck.phoneAvailable === false ||
                (!profile.vendor_name_locked && profileCheck.storeNameAvailable === false)
              }
              className={styles.primaryButton}
            >
              {saving ? "Saving farm profile..." : "Save farm profile"}
            </button>
            </div>
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
