"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./schedule.module.css";

type OrientationNote = {
  id: string;
  title: string;
  audience: "general" | "drivers" | "vendors" | "agri_vendors";
  content: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type NotesData = {
  ok?: boolean;
  admin?: boolean;
  notes?: OrientationNote[];
  error?: string;
};

const EMPTY_FORM = {
  title: "",
  audience: "general",
  content: "",
  sort_order: 100,
  is_active: true,
};

const AUDIENCE_LABELS: Record<string, string> = {
  general: "General",
  drivers: "Drivers",
  vendors: "Vendors",
  agri_vendors: "Agri Vendors",
};

export default function OrientationNotesPanel({ admin }: { admin: boolean }) {
  const [data, setData] = useState<NotesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [audienceFilter, setAudienceFilter] = useState("all");
  const [editingId, setEditingId] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);

  async function load() {
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/admin/operations-orientation-notes", {
        cache: "no-store",
        credentials: "include",
      });
      const body = (await response.json().catch(() => ({}))) as NotesData;

      if (!response.ok || !body?.ok) {
        throw new Error(body?.error || "Orientation notes could not be loaded.");
      }

      setData(body);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Orientation notes could not be loaded."
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

  function edit(note: OrientationNote) {
    setEditingId(note.id);
    setForm({
      title: note.title,
      audience: note.audience,
      content: note.content,
      sort_order: note.sort_order,
      is_active: note.is_active,
    });
    setMessage("");
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!admin || saving) return;

    setSaving(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch("/api/admin/operations-orientation-notes", {
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
        throw new Error(body?.error || "Orientation note could not be saved.");
      }

      setMessage(editingId ? "Cheat sheet updated." : "Cheat sheet added.");
      resetForm();
      await load();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Orientation note could not be saved."
      );
    } finally {
      setSaving(false);
    }
  }

  async function remove(note: OrientationNote) {
    if (!admin || saving) return;
    if (!window.confirm('Delete "' + note.title + '" from Orientation Notes?')) {
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch("/api/admin/operations-orientation-notes", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ id: note.id }),
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok || !body?.ok) {
        throw new Error(body?.error || "Orientation note could not be deleted.");
      }

      if (editingId === note.id) resetForm();
      setMessage("Cheat sheet deleted.");
      await load();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Orientation note could not be deleted."
      );
    } finally {
      setSaving(false);
    }
  }

  async function copyNote(note: OrientationNote) {
    try {
      const text =
        note.title +
        "\n" +
        AUDIENCE_LABELS[note.audience] +
        "\n\n" +
        note.content;
      await navigator.clipboard.writeText(text);
      setMessage("Cheat sheet copied.");
      setError("");
    } catch {
      setError("Could not copy the cheat sheet on this device.");
    }
  }

  const notes = useMemo(() => {
    const list = data?.notes || [];
    const needle = query.trim().toLowerCase();

    return list.filter((note) => {
      if (audienceFilter !== "all" && note.audience !== audienceFilter) {
        return false;
      }
      if (!needle) return true;

      return [note.title, note.content, AUDIENCE_LABELS[note.audience]]
        .map((value) => String(value || "").toLowerCase())
        .some((value) => value.includes(needle));
    });
  }, [data, query, audienceFilter]);

  return (
    <section className={styles.panel}>
      <div className={styles.resourcesHeader}>
        <div>
          <h2>Orientation Notes / Cheat Sheets</h2>
          <p>
            Talking points for staff conducting driver, vendor, and Agri Vendor
            orientations. Admin maintains the notes; employees use them as a
            read-only guide during orientation.
          </p>
        </div>
        <div className={styles.orientationControls}>
          <label htmlFor="orientation-audience-filter">Show</label>
          <select
            id="orientation-audience-filter"
            value={audienceFilter}
            onChange={(event) => setAudienceFilter(event.target.value)}
          >
            <option value="all">All audiences</option>
            <option value="general">General</option>
            <option value="drivers">Drivers</option>
            <option value="vendors">Vendors</option>
            <option value="agri_vendors">Agri Vendors</option>
          </select>

          <label htmlFor="orientation-search">Search</label>
          <input
            id="orientation-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search orientation notes"
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
              <h3>{editingId ? "Edit cheat sheet" : "Add cheat sheet"}</h3>
              <p>
                Keep this concise enough to follow while speaking, but detailed
                enough that another employee can conduct the orientation
                consistently.
              </p>
            </div>
            {editingId ? (
              <button type="button" onClick={resetForm} disabled={saving}>
                Cancel edit
              </button>
            ) : null}
          </div>

          <div className={styles.orientationFormGrid}>
            <label>
              Title
              <input
                required
                maxLength={140}
                value={form.title}
                onChange={(event) =>
                  setForm({ ...form, title: event.target.value })
                }
                placeholder="Driver Orientation - Main Talking Points"
              />
            </label>

            <label>
              Audience
              <select
                value={form.audience}
                onChange={(event) =>
                  setForm({ ...form, audience: event.target.value })
                }
              >
                <option value="general">General</option>
                <option value="drivers">Drivers</option>
                <option value="vendors">Vendors</option>
                <option value="agri_vendors">Agri Vendors</option>
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

            <label className={styles.orientationContentField}>
              Cheat sheet / talking points
              <textarea
                required
                rows={12}
                maxLength={12000}
                value={form.content}
                onChange={(event) =>
                  setForm({ ...form, content: event.target.value })
                }
                placeholder={
                  "Example:\n1. Introduce JRide and the purpose of the app.\n2. Explain the booking flow.\n3. Review important rules and common mistakes.\n4. Demonstrate the app.\n5. Ask for questions."
                }
              />
              <small>{form.content.length.toLocaleString()} / 12,000 characters</small>
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
              disabled={
                saving || !form.title.trim() || !form.content.trim()
              }
            >
              {saving
                ? "Saving..."
                : editingId
                ? "Save changes"
                : "Add cheat sheet"}
            </button>
          </div>
        </form>
      ) : null}

      {loading && !data ? <p>Loading orientation notes...</p> : null}

      {!loading && data && !notes.length ? (
        <div className={styles.resourceEmpty}>
          <strong>No orientation notes in this view yet.</strong>
          <p>
            {admin
              ? "Add the first driver, vendor, Agri Vendor, or general cheat sheet above."
              : "Admin has not published a cheat sheet for this audience yet."}
          </p>
        </div>
      ) : null}

      <div className={styles.orientationGrid}>
        {notes.map((note) => (
          <article
            key={note.id}
            className={[
              styles.orientationCard,
              note.is_active ? "" : styles.resourceInactive,
            ].join(" ")}
          >
            <div className={styles.resourceCardTop}>
              <div>
                <div className={styles.resourceBadges}>
                  <span>{AUDIENCE_LABELS[note.audience] || note.audience}</span>
                  {!note.is_active ? <span>Hidden</span> : null}
                </div>
                <h3>{note.title}</h3>
              </div>
              {admin ? <small>Order {note.sort_order}</small> : null}
            </div>

            <div className={styles.orientationContent}>{note.content}</div>

            <div className={styles.resourceActions}>
              <button type="button" onClick={() => copyNote(note)}>
                Copy cheat sheet
              </button>
              {admin ? (
                <>
                  <button type="button" onClick={() => edit(note)}>
                    Edit
                  </button>
                  <button
                    type="button"
                    className={styles.resourceDelete}
                    onClick={() => remove(note)}
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
