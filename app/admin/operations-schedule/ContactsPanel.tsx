"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./schedule.module.css";

type DriverContact = {
  id: string;
  name: string;
  town: string;
  phone: string | null;
};

type VendorContact = {
  id: string;
  name: string;
  town: string;
  contact_name: string | null;
  phone: string | null;
  status: string | null;
};

type ContactData = {
  ok: boolean;
  generated_at: string;
  drivers: DriverContact[];
  vendors: VendorContact[];
};

function phoneParts(value: string | null) {
  return String(value || "")
    .split(/[\\/,;]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function PhoneLinks({ value }: { value: string | null }) {
  const parts = phoneParts(value);

  if (!parts.length) {
    return <span className={styles.missingPhone}>No number recorded</span>;
  }

  return (
    <span className={styles.contactPhones}>
      {parts.map((phone) => (
        <a key={phone} href={"tel:" + phone}>
          {phone}
        </a>
      ))}
    </span>
  );
}

export default function ContactsPanel() {
  const [data, setData] = useState<ContactData | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/admin/operations-contacts", {
        cache: "no-store",
        credentials: "include",
      });
      const body = await response.json();

      if (!response.ok || !body?.ok) {
        throw new Error(body?.error || "Contacts could not be loaded.");
      }

      setData(body);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Contacts could not be loaded."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const normalizedQuery = query.trim().toLowerCase();

  const drivers = useMemo(() => {
    const list = data?.drivers || [];
    if (!normalizedQuery) return list;

    return list.filter((driver) =>
      [driver.name, driver.town, driver.phone]
        .map((value) => String(value || "").toLowerCase())
        .some((value) => value.includes(normalizedQuery))
    );
  }, [data, normalizedQuery]);

  const vendors = useMemo(() => {
    const list = data?.vendors || [];
    if (!normalizedQuery) return list;

    return list.filter((vendor) =>
      [
        vendor.name,
        vendor.town,
        vendor.contact_name,
        vendor.phone,
        vendor.status,
      ]
        .map((value) => String(value || "").toLowerCase())
        .some((value) => value.includes(normalizedQuery))
    );
  }, [data, normalizedQuery]);

  return (
    <section className={styles.panel}>
      <div className={styles.contactsToolbar}>
        <div>
          <h2>Driver and Vendor Contacts</h2>
          <p>
            Operational contacts for JRide staff. Archived, deactivated, test,
            and removed-from-pilot records are excluded.
          </p>
        </div>
        <div className={styles.contactActions}>
          <label htmlFor="operations-contact-search">Search contacts</label>
          <input
            id="operations-contact-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Name, town, contact person, or phone"
          />
          <button type="button" onClick={load} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh contacts"}
          </button>
        </div>
      </div>

      {error ? (
        <div className={styles.error}>
          {error} <button onClick={load}>Retry</button>
        </div>
      ) : null}

      {loading && !data ? <p>Loading contacts...</p> : null}

      {data ? (
        <div className={styles.contactsGrid}>
          <section className={styles.contactColumn}>
            <header className={styles.contactColumnHeader}>
              <strong>Drivers</strong>
              <span>
                {drivers.length}
                {normalizedQuery
                  ? " shown / " + data.drivers.length + " operational"
                  : " operational"}
              </span>
            </header>
            <div className={styles.contactList}>
              {drivers.length ? (
                drivers.map((driver) => (
                  <article key={driver.id} className={styles.contactRow}>
                    <div>
                      <strong>{driver.name}</strong>
                      <small>{driver.town}</small>
                    </div>
                    <PhoneLinks value={driver.phone} />
                  </article>
                ))
              ) : (
                <p className={styles.contactEmpty}>
                  No drivers match this search.
                </p>
              )}
            </div>
          </section>

          <section className={styles.contactColumn}>
            <header className={styles.contactColumnHeader}>
              <strong>Vendors</strong>
              <span>
                {vendors.length}
                {normalizedQuery
                  ? " shown / " + data.vendors.length + " current"
                  : " current"}
              </span>
            </header>
            <div className={styles.contactList}>
              {vendors.length ? (
                vendors.map((vendor) => (
                  <article key={vendor.id} className={styles.contactRow}>
                    <div>
                      <strong>{vendor.name}</strong>
                      <small>
                        {vendor.town}
                        {vendor.contact_name
                          ? " - Contact: " + vendor.contact_name
                          : ""}
                      </small>
                    </div>
                    <PhoneLinks value={vendor.phone} />
                  </article>
                ))
              ) : (
                <p className={styles.contactEmpty}>
                  No vendors match this search.
                </p>
              )}
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
