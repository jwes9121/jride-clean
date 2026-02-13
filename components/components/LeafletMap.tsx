"use client";

import dynamic from "next/dynamic";

// Load the real map client-side only
const LeafletMapInner = dynamic(() => import("./LeafletMapInner"), {
  ssr: false,
  // optional loading fallback
  loading: () => <div style={{height: 300}}>Loading mapÃ¢â‚¬¦</div>,
});

export default function LeafletMap(props: {
  center?: [number, number];
  zoom?: number;
  height?: number | string;
}) {
  return <LeafletMapInner {...props} />;
}



