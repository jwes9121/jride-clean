"use client";

import React from "react";
import LocationInput from "./LocationInput";

// Infer props from your existing component so we don't fight its types
type BaseProps = React.ComponentProps<typeof LocationInput>;

type Props = Omit<BaseProps, "onChange"> & {
  onLocationSelect?: (location: { address: string; lat?: number | null; lng?: number | null; raw?: any }) => void;
};

export default function LocationInputSelectAdapter({ onLocationSelect, ...rest }: Props) {
  return (
    <LocationInput
      {...(rest as BaseProps)}
      onChange={(text) => onLocationSelect?.({ address: text })}
    />
  );
}
