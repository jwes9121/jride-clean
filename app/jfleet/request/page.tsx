"use client";
import * as React from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { passengerAuthHeaders, passengerLoginHref, preparePassengerSession } from "@/lib/passenger/browserSession";
import { parseRoutePoints, parseInquiryDetails, ROUTE_ADVISORY } from "@/lib/jfleet/routePlanning";
import type { RoutePoint, PlannedRoute } from "@/lib/jfleet/routePlanning";
import type { DraftPin } from "@/components/jfleet/ItineraryPinMap";
const PinMap=dynamic(()=>import("@/components/jfleet/ItineraryPinMap"),{ssr:false,loading:()=> <p>Loading map...</p>});
const blank=():DraftPin=>({label:"",lat:null,lng:null,notes:""});
const field="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-slate-950";
type Plan={id:string;expires_at:string;points:RoutePoint[];route:PlannedRoute};
export default function JFleetPinnedRequestPage() {
  const [loading,setLoading]=React.useState(true),[token,setToken]=React.useState("");
  const [needLogin,setNeedLogin]=React.useState(false),[error,setError]=React.useState("");
  const [pins,setPins]=React.useState<DraftPin[]>([blank(),blank()]),[selected,setSelected]=React.useState(0);
  const [mode,setMode]=React.useState("round_trip"),[purpose,setPurpose]=React.useState("tour_leisure"),[vehicle,setVehicle]=React.useState("recommend");
  const [start,setStart]=React.useState(""),[end,setEnd]=React.useState(""),[passengers,setPassengers]=React.useState("");
  const [cargo,setCargo]=React.useState(""),[weight,setWeight]=React.useState(""),[luggage,setLuggage]=React.useState(""),[notes,setNotes]=React.useState("");
  const [plan,setPlan]=React.useState<Plan|null>(null),[busy,setBusy]=React.useState(false),[reviewed,setReviewed]=React.useState(false);
  const [submitted,setSubmitted]=React.useState<{inquiry_code:string;quote_due_at:string}|null>(null);
  const inFlight=React.useRef(false),revision=React.useRef(0);
  React.useEffect(()=>{
    let active=true;
    (async()=>{
      try {
        const session=await preparePassengerSession();
        if(!session.authed) { if(active)setNeedLogin(true);return; }
        const r=await fetch("/api/jfleet/planner",{headers:passengerAuthHeaders(),cache:"no-store"});
        const b=await r.json();if(!r.ok || !b.ok) throw new Error(b.message || "Planner unavailable.");
        if(active)setToken(b.map_token);
      } catch(e) {if(active)setError(e instanceof Error?e.message:"Planner unavailable.");}
      finally {if(active)setLoading(false);}
    })();
    return ()=>{active=false;};
  },[]);
  function changed() { revision.current++;setPlan(null);setReviewed(false);setError(""); }
  function edit(index:number,patch:Partial<DraftPin>) { changed();setPins(p=>p.map((x,i)=>i===index?{...x,...patch}:x)); }
  function routePoints():RoutePoint[] {
    const points=mode==="round_trip"?[...pins,{...pins[0],notes:"Return to pickup"}]:pins;
    return parseRoutePoints(points);
  }
  function details() {
    return parseInquiryDetails({purpose,requested_vehicle_type:vehicle,trip_mode:mode,
      scheduled_start_at:start+":00+08:00",scheduled_end_at:end+":00+08:00",
      passenger_count:passengers?Number(passengers):null,cargo_weight_kg:weight?Number(weight):null,
      cargo_description:cargo || null,luggage_notes:luggage || null,special_notes:notes || null});
  }
  async function preview() {
    if(inFlight.current)return;inFlight.current=true;setBusy(true);setError("");setPlan(null);setReviewed(false);
    const rev=revision.current;
    try {
      const points=routePoints();
      const r=await fetch("/api/jfleet/planner",{method:"POST",headers:passengerAuthHeaders(true),body:JSON.stringify({action:"preview",points}),cache:"no-store"});
      const b=await r.json();if(!r.ok || !b.ok)throw new Error(b.message || "Route preview failed.");
      if(rev===revision.current)setPlan(b.plan);
    } catch(e) {setError(e instanceof Error?e.message:"Route preview failed.");}
    finally {inFlight.current=false;setBusy(false);}
  }
  async function submit(e:React.FormEvent) {
    e.preventDefault();if(inFlight.current || !plan || !reviewed)return;
    inFlight.current=true;setBusy(true);setError("");
    try {
      const points=routePoints(),d=details();
      if(JSON.stringify(points)!==JSON.stringify(plan.points))throw new Error("The itinerary changed. Preview it again before submitting.");
      const r=await fetch("/api/jfleet/planner",{method:"POST",headers:passengerAuthHeaders(true),body:JSON.stringify({action:"submit",plan_id:plan.id,points,details:d}),cache:"no-store"});
      const b=await r.json();if(!r.ok || !b.ok)throw new Error(b.message || "Could not submit the inquiry.");
      setSubmitted(b);
    } catch(e) {setError(e instanceof Error?e.message:"Could not submit the inquiry.");}
    finally {inFlight.current=false;setBusy(false);}
  }
  if(loading)return <main className="p-6">Loading JFleet itinerary planner...</main>;
  if(needLogin)return <main className="p-6"><h1 className="text-2xl font-bold">JFleet</h1><Link href={passengerLoginHref("/jfleet/request")} className="underline">Sign in to plan your trip</Link></main>;
  if(!token)return <main className="p-6"><h1 className="text-2xl font-bold">JFleet</h1><p role="alert" className="my-4">{error}</p><Link href="/jfleet" className="underline">Back to JFleet</Link></main>;
  if(submitted)return <main className="mx-auto max-w-2xl space-y-4 p-6"><h1 className="text-2xl font-bold">Quote requested</h1><p>{submitted.inquiry_code}</p><p>This is an inquiry, not a confirmed reservation. Response due: {new Date(submitted.quote_due_at).toLocaleString("en-PH",{timeZone:"Asia/Manila"})} Philippines time.</p><Link href="/jfleet" className="underline">View inquiries and bookings</Link></main>;
  return <main className="min-h-screen bg-slate-50 p-4 text-slate-950 sm:p-6"><form onSubmit={submit} className="mx-auto max-w-4xl space-y-5">
    <header className="rounded-2xl bg-slate-950 p-6 text-white"><h1 className="text-3xl font-bold">JFleet</h1><p>Vans, Pickups & Trucks for Hire</p><p className="mt-3 text-sm">Request a quotation with a complete, map-pinned itinerary. This is not an instant booking.</p></header>
    <fieldset disabled={busy} className="space-y-5 disabled:opacity-70">
      <section className="grid gap-4 rounded-2xl border bg-white p-5 sm:grid-cols-2">
        <label>Purpose<select className={field} value={purpose} onChange={e=>setPurpose(e.target.value)}>{[["tour_leisure","Tour / Leisure"],["family","Family trip"],["business","Business"],["event","Event"],["cargo_delivery","Cargo / Delivery"],["moving_hauling","Moving / Hauling"],["other","Other"]].map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
        <label>Vehicle<select className={field} value={vehicle} onChange={e=>setVehicle(e.target.value)}>{[["recommend","Let operator recommend"],["van","Van"],["pickup","Pickup truck"],["truck","Truck"]].map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
        <label>Trip type<select className={field} value={mode} onChange={e=>{changed();setMode(e.target.value);}}><option value="one_way">One-way</option><option value="round_trip">Round trip - return to pickup</option><option value="multi_day">Multi-day - specify final destination</option></select></label>
        <label>Number of passengers<input type="number" min="1" step="1" className={field} value={passengers} onChange={e=>setPassengers(e.target.value)} /></label>
        <label>Departure - Philippines time<input required type="datetime-local" className={field} value={start} onChange={e=>setStart(e.target.value)} /></label>
        <label>Expected trip end - Philippines time<input required type="datetime-local" className={field} value={end} onChange={e=>setEnd(e.target.value)} /></label>
      </section>
      <section className="space-y-4 rounded-2xl border bg-white p-5"><h2 className="text-xl font-bold">Pin every pickup and destination</h2>
        {pins.map((p,i)=><div key={i} className={"rounded-xl border p-3 "+(selected===i?"border-emerald-700":"border-slate-200")}>
          <div className="flex flex-wrap items-center justify-between gap-2"><strong>{i===0?"1. Pickup":String(i+1)+". "+(i===pins.length-1?"Destination":"Stop")}</strong><button type="button" onClick={()=>setSelected(i)} className="rounded-lg border px-3 py-2">{p.lat===null?"Set pin":"Change pin"}</button>{i>0&&pins.length>2?<button type="button" onClick={()=>{changed();setSelected(0);setPins(x=>x.filter((_,n)=>n!==i));}} className="text-sm text-red-800">Remove</button>:null}</div>
          <label className="text-sm">Location or landmark<input required minLength={2} maxLength={180} className={field} value={p.label} onChange={e=>edit(i,{label:e.target.value,lat:null,lng:null})} placeholder="Type the location, then confirm its pin" /></label>
          <label className="text-sm">Stop instructions or intended time at this stop<input maxLength={500} className={field} value={p.notes} onChange={e=>edit(i,{notes:e.target.value})} /></label>
          <p className="mt-2 text-xs">{p.lat===null||p.lng===null?"Map pin not confirmed":p.lat.toFixed(6)+", "+p.lng.toFixed(6)}</p>
        </div>)}
        <button type="button" disabled={pins.length>=(mode==="round_trip"?20:21)} onClick={()=>{changed();setSelected(pins.length);setPins(p=>[...p,blank()]);}} className="rounded-xl border px-4 py-3">+ Add stop</button>
        {mode==="round_trip"?<p className="text-sm">The final return to the pickup pin is added automatically after all listed destinations.</p>:null}
        <PinMap token={token} points={pins} selected={selected} route={plan?.route??null} disabled={busy} onPin={(lat,lng)=>edit(selected,{lat,lng})} />
        <button type="button" onClick={()=>void preview()} className="rounded-xl bg-slate-950 px-4 py-3 font-semibold text-white">Preview road route</button>
        {plan?<div className="space-y-2 rounded-xl bg-emerald-50 p-4"><p><strong>{(plan.route.distance_m/1000).toFixed(1)} km</strong> routed distance | Approximately {Math.ceil(plan.route.duration_s/60)} minutes of driving</p><p className="text-sm">{ROUTE_ADVISORY}</p><p className="text-xs">Preview valid until {new Date(plan.expires_at).toLocaleString("en-PH",{timeZone:"Asia/Manila"})} Philippines time. Editing a pin or itinerary invalidates this preview.</p></div>:null}
      </section>
      <section className="grid gap-4 rounded-2xl border bg-white p-5 sm:grid-cols-2">
        <label>Cargo description<textarea maxLength={1000} className={field} value={cargo} onChange={e=>setCargo(e.target.value)} /></label>
        <label>Estimated cargo weight (kg)<input type="number" min="0.001" step="0.001" className={field} value={weight} onChange={e=>setWeight(e.target.value)} /></label>
        <label>Luggage / equipment<textarea maxLength={1000} className={field} value={luggage} onChange={e=>setLuggage(e.target.value)} /></label>
        <label>Special requirements<textarea maxLength={1500} className={field} value={notes} onChange={e=>setNotes(e.target.value)} /></label>
      </section>
      <section className="space-y-3 rounded-2xl border bg-white p-5"><p className="text-sm">The operator prices the complete itinerary, duration and fuel. Additions after departure are separate charges. Minimum reservation: 20% after quote acceptance. The original quote must be fully paid before departure. Cancellation at least 48 hours before departure: full refund of amount paid. Later cancellation before departure: 10% of the accepted quote is forfeited.</p><label className="flex gap-3"><input type="checkbox" checked={reviewed} disabled={!plan} onChange={e=>setReviewed(e.target.checked)} /><span>I reviewed the ordered stops and road-route preview. I understand this is a quote inquiry, not a vehicle reservation.</span></label></section>
    </fieldset>
    {error?<p role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">{error}</p>:null}
    <button type="submit" disabled={busy||!plan||!reviewed} className="w-full rounded-xl bg-emerald-800 px-5 py-3 font-bold text-white disabled:opacity-50">{busy?"Please wait...":"Request Quote"}</button>
    <Link href="/jfleet" className="block underline">Back to JFleet inquiries and bookings</Link>
  </form></main>;
}
