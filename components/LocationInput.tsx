"use client";

import React, { useCallback, useMemo, useState } from "react";

export type GeoLocation = {
  address: string;
  lat?: number | null;
  lng?: number | null;
  raw?: any;
};

export type LocationInputProps = {
  label: string;
  value: string;
  placeholder?: string;
  icon?: string;
  iconColor?: string;
  onLocationSelect?: (location: GeoLocation) => void;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  footer?: React.ReactNode;
};

export default function LocationInput({
  label,
  value,
  placeholder = "Search address...",
  icon,
  iconColor = "gray",
  onLocationSelect,
  onChange,
  readOnly,
  footer,
}: LocationInputProps) {
  const [query, setQuery] = useState(value ?? "");
  const [open, setOpen] = useState(false);

  const suggestions = useMemo(() => {
    if (!query || !query.trim()) return [];
    return [{ address: query, lat: null, lng: null } as GeoLocation];
  }, [query]);

  const handleInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = e.target.value;
      setQuery(v);
      if (onChange) onChange(v);
      setOpen(!!v);
    },
    [onChange]
  );

  const selectLocation = useCallback(
    (loc: GeoLocation) => {
      setQuery(loc.address);
      setOpen(false);
      if (onLocationSelect) onLocationSelect(loc);
    },
    [onLocationSelect]
  );

  const confirmEnter = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        selectLocation({ address: query });
      }
    },
    [query, selectLocation]
  );

  return (
    <div className="space-y-1">
      <label className="block text-sm font-medium text-gray-700">{label}</label>

      <div className="relative">
        <input
          type="text"
          className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring"
          value={query}
          onChange={handleInput}
          onKeyDown={confirmEnter}
          onFocus={() => setOpen(!!query)}
          readOnly={readOnly}
          placeholder={placeholder}
        />

        {icon ? (
          <i
            className={
              "absolute right-2 top-1/2 -translate-y-1/2 " +
              icon +
              " text-" +
              iconColor +
              "-500"
            }
            aria-hidden
          />
        ) : null}

        {open && suggestions.length > 0 && (
          <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border bg-white shadow">
            <ul className="max-h-56 overflow-auto text-sm">
              {suggestions.map((s, i) => (
                <li
                  key={i}
                  className="cursor-pointer px-3 py-2 hover:bg-gray-50"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectLocation(s);
                  }}
                >
                  {s.address}
                </li>
              ))}
            </ul>
            {footer ? (
              <div className="border-t px-3 py-2 text-xs text-gray-500">
                {footer}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
