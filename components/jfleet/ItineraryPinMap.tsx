"use client";
import * as React from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { PlannedRoute } from "@/lib/jfleet/routePlanning";

export type DraftPin = { label: string; lat: number | null; lng: number | null; notes: string };
type Props = { token: string; points: DraftPin[]; selected: number; route: PlannedRoute | null; disabled: boolean; onPin: (lat: number,lng: number) => void };
export default function ItineraryPinMap({token,points,selected,route,disabled,onPin}: Props) {
  const container=React.useRef<HTMLDivElement>(null);
  const map=React.useRef<mapboxgl.Map | null>(null);
  const markers=React.useRef<mapboxgl.Marker[]>([]);
  const pendingMarker=React.useRef<mapboxgl.Marker | null>(null);
  const [ready,setReady]=React.useState(false);
  const [error,setError]=React.useState("");
  const [candidate,setCandidate]=React.useState<{lat:number;lng:number}|null>(null);
  React.useEffect(()=>{
    if(!container.current) return;
    if(!mapboxgl.supported()) { setError("This device cannot display the map. Try another supported browser or device."); return; }
    let m: mapboxgl.Map;
    try {
      // Map viewport only. The center is never saved as a customer's location.
      m=new mapboxgl.Map({container:container.current,accessToken:token,style:"mapbox://styles/mapbox/streets-v12",center:[122,12],zoom:5});
    } catch { setError("The map could not start. No pin has been selected."); return; }
    map.current=m;
    m.addControl(new mapboxgl.NavigationControl());
    m.on("load",()=>{
      m.addSource("jfleet-plan",{type:"geojson",data:{type:"Feature",properties:{},geometry:{type:"LineString",coordinates:[]}}});
      m.addLayer({id:"jfleet-plan-line",type:"line",source:"jfleet-plan",paint:{"line-color":"#059669","line-width":5}});
      setReady(true);
    });
    m.on("error",()=>setError("Some map data could not load. Check your connection before confirming a pin."));
    m.on("click",(e:mapboxgl.MapMouseEvent)=>setCandidate({lat:e.lngLat.lat,lng:e.lngLat.lng}));
    const resize=new ResizeObserver(()=>m.resize());resize.observe(container.current);
    return ()=>{resize.disconnect();markers.current.forEach(x=>x.remove());markers.current=[];pendingMarker.current?.remove();pendingMarker.current=null;m.remove();map.current=null;};
  },[token]);
  React.useEffect(()=>{
    setCandidate(null);
    const p=points[selected];
    if(map.current && p?.lat!==null && p?.lat!==undefined && p.lng!==null) map.current.easeTo({center:[p.lng,p.lat],zoom:14});
  },[selected]); // Move between stops without resetting the camera on every edit.
  React.useEffect(()=>{
    if(!ready || !map.current) return;
    markers.current.forEach(m=>m.remove());
    markers.current=points.flatMap((p,i)=>{
      if(p.lat===null || p.lng===null) return [];
      const el=document.createElement("div");el.textContent=String(i+1);el.className="rounded-full border-2 border-white bg-slate-950 px-2 py-1 text-xs font-bold text-white shadow";
      return [new mapboxgl.Marker({element:el}).setLngLat([p.lng,p.lat]).addTo(map.current!)];
    });
  },[points,ready]);
  React.useEffect(()=>{
    pendingMarker.current?.remove();pendingMarker.current=null;
    if(candidate && ready && map.current) pendingMarker.current=new mapboxgl.Marker({color:"#d97706"}).setLngLat([candidate.lng,candidate.lat]).addTo(map.current);
  },[candidate,ready]);
  React.useEffect(()=>{
    const m=map.current;if(!ready || !m) return;
    const source=m.getSource("jfleet-plan") as mapboxgl.GeoJSONSource;
    source.setData({type:"Feature",properties:{},geometry:route?.geometry ?? {type:"LineString",coordinates:[]}});
    if(route) {
      const bounds=new mapboxgl.LngLatBounds();route.geometry.coordinates.forEach(c=>bounds.extend([c[0],c[1]]));
      m.fitBounds(bounds,{padding:35,maxZoom:14});
    }
  },[route,ready]);
  return <section className="space-y-3">
    <p className="text-sm">Select a stop, then tap its exact position on the map. Confirm the pin below.</p>
    <div ref={container} className="h-80 w-full overflow-hidden rounded-xl border" aria-label="JFleet itinerary pin map" />
    {error?<p role="alert" className="text-sm text-red-800">{error}</p>:null}
    <p className="text-sm font-semibold">Editing point {selected+1}: {points[selected]?.label || "Unnamed point"}</p>
    {candidate?<p className="text-xs">Selected position: {candidate.lat.toFixed(6)}, {candidate.lng.toFixed(6)}</p>:null}
    <button type="button" disabled={disabled || !candidate || !ready} onClick={()=>{if(candidate){onPin(candidate.lat,candidate.lng);setCandidate(null);}}} className="rounded-xl bg-emerald-800 px-4 py-3 font-semibold text-white disabled:opacity-50">Confirm pin for point {selected+1}</button>
  </section>;
}
