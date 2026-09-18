"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./schedule.module.css";

type Resource = {
  id: string;
  title: string;
  description: string | null;
  url: string;
  category: "apk" | "link" | "guide" | "form" | "other";
  audience: "all" | "drivers" | "vendors" | "passengers" | "staff";
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type ResourceData = {
  ok?: boolean;
  admin?: boolean;
  resources?: Resource[];
  error?: string;
};

const EMPTY_FORM = {
  title: "",
  description: "",
  url: "",
  category: "link",
  audience: "all",
  sort_order: 100,
  is_active: true,
};

const CATEGORY_LABELS: Record<string, string> = {
  apk: "APK / App",
  link: "Useful Link",
  guide: "Guide",
  form: "Form",
  other: "Other",
};

const AUDIENCE_LABELS: Record<string, string> = {
  all: "Everyone",
  drivers: "Drivers",
  vendors: "Vendors",
  passengers: "Passengers",
  staff: "JRide Staff",
};

export default function ToolsLinksPanel({ admin }: { admin: boolean }) {
  const [data, setData] = useState<ResourceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);

  async function load() {
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/admin/operations-resources", {
        cache: "no-store",
        credentials: "include",
      });
      const body = (await response.json().catch(() => ({}))) as ResourceData;

      if (!response.ok || !body?.ok) {
        throw new Error(body?.error || "Tools and links could not be loaded.");
      }

      setData(body);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Tools and links could not be loaded."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function resetForm() {
    setEditingId("");
    setForm(EMPTY_FORM);
  }

  function edit(resource: Resource) {
    setEditingId(resource.id);
    setForm({
      title: resource.title,
      description: resource.description || "",
      url: resource.url,
      category: resource.category,
      audience: resource.audience,
      sort_order: resource.sort_order,
      is_active: resource.is_active,
    });
    setMessage("");
    setError("");
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!admin || saving) return;

    setSaving(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch("/api/admin/operations-resources", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          id: editingId || undefined,
          ...form,
        }),
      });

      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body?.ok) {
        throw new Error(body?.error || "Resource could not be saved.");
      }

      setMessage(editingId ? "Tool or link updated." : "Tool or link added.");
      resetForm();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Resource could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(resource: Resource) {
    if (!admin || saving) return;
    if (!window.confirm('Delete "' + resource.title + '" from staff tools and links?')) {
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch("/api/admin/operations-resources", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ id: resource.id }),
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok || !body?.ok) {
        throw new Error(body?.error || "Resource could not be deleted.");
      }

      if (editingId === resource.id) resetForm();
      setMessage("Tool or link deleted.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Resource could not be deleted.");
    } finally {
      setSaving(false);
    }
  }

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setMessage("Link copied.");
      setError("");
    } catch {
      setError("Could not copy the link on this device.");
    }
  }

  const resources = useMemo(() => {
    const list = data?.resources || [];
    const needle = query.trim().toLowerCase();
    if (!needle) return list;

    return list.filter((item) =>
      [
        item.title,
        item.description,
        item.category,
        item.audience,
        item.url,
      ]
        .map((value) => String(value || "").toLowerCase())
        .some((value) => value.includes(needle))
    );
  }, [data, query]);

  return (
    <section className={styles.panel}>
      <div className={styles.resourcesHeader}>
        <div>
          <h2>Tools &amp; Links</h2>
          <p>
            Shared operational resources provided by Admin. Use this for APKs,
            forms, guides, important pages, and other staff tools.
          </p>
        </div>
        <div className={styles.resourcesSearch}>
          <label htmlFor="operations-resource-search">Search</label>
          <input
            id="operations-resource-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search tools, APKs, guides, or links"
          />
          <button type="button" onClick={load} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      {error ? <div className={styles.error}>{error}</div> : null}
      {message ? <div className={styles.success}>{message}</div> : null}

      {admin ? (
        <form className={styles.resourceForm} onSubmit={save}>
          <div className={styles.resourceFormHeader}>
            <div>
              <h3>{editingId ? "Edit tool or link" : "Add tool or link"}</h3>
              <p>
                Admin controls what employees see. Paste the current official
                link whenever an APK or resource changes.
              </p>
            </div>
            {editingId ? (
              <button type="button" onClick={resetForm} disabled={saving}>
                Cancel edit
              </button>
            ) : null}
          </div>

          <div className={styles.resourceFormGrid}>
            <label>
              Name
              <input
                required
                maxLength={120}
                value={form.title}
                onChange={(event) =>
                  setForm({ ...form, title: event.target.value })
                }
                placeholder="Driver APK"
              />
            </label>

            <label>
              Type
              <select
                value={form.category}
                onChange={(event) =>
                  setForm({ ...form, category: event.target.value })
                }
              >
                <option value="apk">APK / App</option>
                <option value="link">Useful Link</option>
                <option value="guide">Guide</option>
                <option value="form">Form</option>
                <option value="other">Other</option>
              </select>
            </label>

            <label>
              For
              <select
                value={form.audience}
                onChange={(event) =>
                  setForm({ ...form, audience: event.target.value })
                }
              >
                <option value="all">Everyone</option>
                <option value="drivers">Drivers</option>
                <option value="vendors">Vendors</option>
                <option value="passengers">Passengers</option>
                <option value="staff">JRide Staff</option>
              </select>
            </label>

            <label>
              Display order
              <input
                type="number"
                min={0}
                max={9999}
                value={form.sort_order}
                onChange={(event) =>
                  setForm({
                    ...form,
                    sort_order: Number(event.target.value || 0),
                  })
                }
              />
            </label>

            <label className={styles.resourceUrlField}>
              Link
              <input
                required
                type="url"
                value={form.url}
                onChange={(event) =>
                  setForm({ ...form, url: event.target.value })
                }
                placeholder="https://..."
              />
            </label>

            <label className={styles.resourceDescriptionField}>
              Description / instructions
              <textarea
                rows={3}
                maxLength={500}
                value={form.description}
                onChange={(event) =>
                  setForm({ ...form, description: event.target.value })
                }
                placeholder="What this is for, who should use it, or any install instructions."
              />
            </label>
          </div>

          <div className={styles.resourceFormFooter}>
            <label className={styles.resourceToggle}>
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(event) =>
                  setForm({ ...form, is_active: event.target.checked })
                }
              />
              Visible to employees
            </label>
            <button
              type="submit"
              className={styles.primary}
              disabled={saving || !form.title.trim() || !form.url.trim()}
            >
              {saving
                ? "Saving..."
                : editingId
                ? "Save changes"
                : "Add to Tools & Links"}
            </button>
          </div>
        </form>
      ) : null}

      {loading && !data ? <p>Loading tools and links...</p> : null}

      {!loading && data && !resources.length ? (
        <div className={styles.resourceEmpty}>
          <strong>No tools or links available yet.</strong>
          <p>
            {admin
              ? "Add the first APK, guide, form, or useful link above."
              : "Admin has not published any resources yet."}
          </p>
        </div>
      ) : null}

      <div className={styles.resourceGrid}>
        {resources.map((resource) => (
          <article
            key={resource.id}
            className={[
              styles.resourceCard,
              resource.is_active ? "" : styles.resourceInactive,
            ].join(" ")}
          >
            <div className={styles.resourceCardTop}>
              <div>
                <div className={styles.resourceBadges}>
                  <span>{CATEGORY_LABELS[resource.category] || resource.category}</span>
                  <span>{AUDIENCE_LABELS[resource.audience] || resource.audience}</span>
                  {!resource.is_active ? <span>Hidden</span> : null}
                </div>
                <h3>{resource.title}</h3>
              </div>
              {admin ? <small>Order {resource.sort_order}</small> : null}
            </div>

            {resource.description ? (
              <p className={styles.resourceDescription}>
                {resource.description}
              </p>
            ) : null}

            <div className={styles.resourceLinkPreview}>{resource.url}</div>

            <div className={styles.resourceActions}>
              <a
                href={resource.url}
                target="_blank"
                rel="noreferrer noopener"
                className={styles.resourcePrimaryAction}
              >
                {resource.category === "apk" ? "Download / open" : "Open"}
              </a>
              <button type="button" onClick={() => copyLink(resource.url)}>
                Copy link
              </button>
              {admin ? (
                <>
                  <button type="button" onClick={() => edit(resource)}>
                    Edit
                  </button>
                  <button
                    type="button"
                    className={styles.resourceDelete}
                    onClick={() => remove(resource)}
                  >
                    Delete
                  </button>
                </>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
