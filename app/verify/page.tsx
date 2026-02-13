"use client";

import { FormEvent, useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type VerificationRecord = {
  id: number;
  status: string;
  reject_reason: string | null;
  id_photo_url: string | null;
  selfie_photo_url: string | null;
};

export default function PassengerVerifyPage() {
  const [userId, setUserId] = useState<string>("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [idType, setIdType] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [idPhotoUrl, setIdPhotoUrl] = useState("");
  const [selfieUrl, setSelfieUrl] = useState("");

  const [idFile, setIdFile] = useState<File | null>(null);
  const [selfieFile, setSelfieFile] = useState<File | null>(null);

  const [current, setCurrent] = useState<VerificationRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [authUserPresent, setAuthUserPresent] = useState(false);

  // Try to auto-detect logged in user and prefill userId
  useEffect(() => {
    const loadUser = async () => {
      const { data, error } = await supabase.auth.getUser();
      if (error) {
        console.warn("getUser error (okay for local testing):", error);
        return;
      }
      if (data?.user) {
        setUserId(data.user.id);
        setAuthUserPresent(true);
      }
    };
    loadUser();
  }, []);

  // Load existing verification for this userId (when set)
  useEffect(() => {
    if (!userId) return;
    const loadExisting = async () => {
      const { data, error } = await supabase
        .from("passenger_verifications")
        .select("id,status,reject_reason,id_photo_url,selfie_photo_url")
        .eq("user_id", userId)
        .maybeSingle();

      if (!error && data) {
        setCurrent(data as VerificationRecord);
        if (data.id_photo_url) setIdPhotoUrl(data.id_photo_url);
        if (data.selfie_photo_url) setSelfieUrl(data.selfie_photo_url);
      } else if (error && error.code !== "PGRST116") {
        console.error("loadExisting error", error);
      }
    };
    loadExisting();
  }, [userId]);

  const uploadToStorage = async (file: File, kind: "id" | "selfie"): Promise<string | null> => {
    if (!file) return null;
    const bucket = "passenger-ids";
    const safeUserId = userId || "anon";
    const ext = file.name.split(".").pop() || "jpg";
    const path = `${safeUserId}/${kind}-${Date.now()}.${ext}`;

    const { data, error } = await supabase.storage
      .from(bucket)
      .upload(path, file, {
        upsert: true,
      });

    if (error || !data) {
      console.error("uploadToStorage error", error);
      setMessage("Error uploading file. Please try again.");
      return null;
    }

    const { data: publicData } = supabase.storage
      .from(bucket)
      .getPublicUrl(data.path);

    return publicData.publicUrl;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setMessage(null);

    if (!userId) {
      setMessage("Please enter a user ID (or log in).");
      return;
    }
    if (!fullName || !phone || !idType || !idNumber) {
      setMessage("Please complete all text fields.");
      return;
    }

    setLoading(true);

    // If we have files selected and no URL yet, upload them
    let finalIdUrl = idPhotoUrl;
    let finalSelfieUrl = selfieUrl;

    if (!finalIdUrl && idFile) {
      const url = await uploadToStorage(idFile, "id");
      if (url) {
        finalIdUrl = url;
        setIdPhotoUrl(url);
      }
    }
    if (!finalSelfieUrl && selfieFile) {
      const url = await uploadToStorage(selfieFile, "selfie");
      if (url) {
        finalSelfieUrl = url;
        setSelfieUrl(url);
      }
    }

    if (!finalIdUrl || !finalSelfieUrl) {
      setLoading(false);
      setMessage(
        "Please upload both ID photo and selfie, or provide their URLs."
      );
      return;
    }

    const { data, error } = await supabase.rpc(
      "passenger_request_verification",
      {
        p_user_id: userId,
        p_full_name: fullName,
        p_phone: phone,
        p_id_type: idType,
        p_id_number: idNumber,
        p_id_photo_url: finalIdUrl,
        p_selfie_photo_url: finalSelfieUrl,
      }
    );

    setLoading(false);

    if (error) {
      console.error("passenger_request_verification error", error);
      setMessage("Error submitting verification. Please try again.");
      return;
    }

    setCurrent(data as VerificationRecord);
    setMessage("Verification submitted. Dispatcher will review first, then Admin will verify.");
  };
  const statusLabel = () => {
    if (!current) return "Not submitted";
    switch (current.status) {
      case "pending":
        return "Submitted (waiting for dispatcher review)";
      case "pre_approved_dispatcher":
        return "Pending admin approval";
      case "approved_admin":
        return "VERIFIED (rides and restricted services allowed)";
      case "rejected":
        return "REJECTED - check reason and re-submit";
      default:
        return String(current.status || "");
    }
  };
return (
    <div className="p-4 text-sm max-w-xl mx-auto">
      <h1 className="text-lg font-bold mb-2">Passenger Verification</h1>
      <p className="text-xs text-gray-600 mb-3">
        Upload your ID details so JRide can verify you. Verified passengers can book rides and access restricted services.
      </p>

      {!authUserPresent && (
        <div className="mb-3 text-xs text-orange-700">
          No logged-in user detected. For testing, paste a passenger <b>user
          UUID</b> below. In production, this will be filled automatically after
          login.
        </div>
      )}

      <div className="flex flex-col mb-3">
        <label className="text-xs mb-1">User ID (UUID)</label>
        <input
          className="border rounded px-2 py-1 text-xs font-mono"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          placeholder="auto-filled when logged in"
        />
      </div>

      <div className="mb-4 text-xs">
        Current status: <b>{statusLabel()}</b>
        {current?.status === "rejected" && current.reject_reason && (
          <div className="text-red-600 mt-1">
            Reason: {current.reject_reason}
          </div>
        )}
      </div>

      {message && <div className="mb-3 text-xs text-blue-700">{message}</div>}

      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="flex flex-col">
          <label className="text-xs mb-1">Full name (same as ID)</label>
          <input
            className="border rounded px-2 py-1 text-sm"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
        </div>

        <div className="flex flex-col">
          <label className="text-xs mb-1">Mobile number</label>
          <input
            className="border rounded px-2 py-1 text-sm"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>

        <div className="flex flex-col">
          <label className="text-xs mb-1">ID type</label>
          <select
            className="border rounded px-2 py-1 text-sm"
            value={idType}
            onChange={(e) => setIdType(e.target.value)}
          >
            <option value="">Select ID type</option>
            <option value="National ID">National ID</option>
            <option value="Driver's License">Driver&apos;s License</option>
            <option value="Passport">Passport</option>
            <option value="UMID">UMID</option>
            <option value="Voter's ID">Voter&apos;s ID</option>
            <option value="Other">Other</option>
          </select>
        </div>

        <div className="flex flex-col">
          <label className="text-xs mb-1">ID number</label>
          <input
            className="border rounded px-2 py-1 text-sm"
            value={idNumber}
            onChange={(e) => setIdNumber(e.target.value)}
          />
        </div>

        <div className="flex flex-col">
          <label className="text-xs mb-1">
            ID photo (front of your ID)
          </label>
          <input
            type="file"
            accept="image/*"
            className="border rounded px-2 py-1 text-sm"
            onChange={(e) => setIdFile(e.target.files?.[0] ?? null)}
          />
          <input
            className="border rounded px-2 py-1 text-xs mt-1"
            value={idPhotoUrl}
            onChange={(e) => setIdPhotoUrl(e.target.value)}
            placeholder="Or paste an existing image URL (optional)"
          />
        </div>

        <div className="flex flex-col">
          <label className="text-xs mb-1">
            Selfie photo (you holding your ID)
          </label>
          <input
            type="file"
            accept="image/*"
            className="border rounded px-2 py-1 text-sm"
            onChange={(e) => setSelfieFile(e.target.files?.[0] ?? null)}
          />
          <input
            className="border rounded px-2 py-1 text-xs mt-1"
            value={selfieUrl}
            onChange={(e) => setSelfieUrl(e.target.value)}
            placeholder="Or paste an existing image URL (optional)"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="mt-2 px-4 py-2 rounded bg-emerald-600 text-white text-sm disabled:opacity-50"
        >
          {loading ? "Submitting?" : "Submit for verification"}
        </button>
      </form>
    </div>
  );
}
