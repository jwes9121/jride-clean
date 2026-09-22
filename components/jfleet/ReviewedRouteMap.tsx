"use client";
import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { RouteContext } from "@/lib/jfleet/routeReview";
export default function ReviewedRouteMap({snapshot,token,onReady}: {
  snapshot: RouteContext["snapshot"]; token: string; onReady: (ready: boolean) => void;
}) {
  const host=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    onReady(false);
    if(!host.current || !token.startsWith("pk.")) return;
    let map: mapboxgl.Map | undefined;
    let alive=true;
    const markers: mapboxgl.Marker[]=[];
    try {
      const points=snapshot.points;
      map=new mapboxgl.Map({container:host.current,accessToken:token,style:"mapbox://styles/mapbox/streets-v12",center:[points[0].lng,points[0].lat],zoom:8});
      map.addControl(new mapboxgl.NavigationControl(),"top-right");
      map.on("error",()=>{ if(alive) onReady(false); });
      map.on("load",()=>{
        if(!map || !alive) return;
        map.addSource("review-route",{type:"geojson",data:{type:"Feature",properties:{},geometry:snapshot.route.geometry as GeoJSON.LineString}});
        map.addLayer({id:"review-route",type:"line",source:"review-route",paint:{"line-color":"#047857","line-width":5}});
        const bounds=new mapboxgl.LngLatBounds();
        snapshot.route.geometry.coordinates.forEach(c=>bounds.extend([c[0],c[1]]));
        points.forEach((p,index)=>{
          const el=document.createElement("div");
          el.textContent=String(index+1); el.className="rounded-full bg-slate-950 text-white px-2 py-1 font-bold border-2 border-white";
          markers.push(new mapboxgl.Marker({element:el}).setLngLat([p.lng,p.lat]).setPopup(new mapboxgl.Popup().setText((index+1)+". "+p.label)).addTo(map!));
          bounds.extend([p.lng,p.lat]);
        });
        map.fitBounds(bounds,{padding:40,maxZoom:14,duration:0});
        map.once("idle",()=>{ if(alive) onReady(true); });
      });
    } catch { onReady(false); }
    return ()=>{ alive=false; markers.forEach(m=>m.remove()); map?.remove(); };
  },[snapshot,token,onReady]);
  return <div ref={host} className="h-80 w-full rounded-xl overflow-hidden border" aria-label="Saved road route and ordered stops" />;
}
