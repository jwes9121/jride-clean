"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { REVIEW_ACK, REVIEW_NOTICE, philippinesTime, type RouteContext, type Decision } from "@/lib/jfleet/routeReview";
const RouteMap=dynamic(()=>import("@/components/jfleet/ReviewedRouteMap"),{ssr:false,loading:()=> <p>Loading route map...</p>});
type Inquiry={id:string;inquiry_code:string;status:string;pickup_label:string;requested_vehicle_type:string;scheduled_start_at:string;quote_due_at:string};
type Context=RouteContext & {map_token:string | null};
const field="w-full rounded-lg border border-slate-300 bg-white px-3 py-2";
async function request(url:string,body?:unknown) {
  const r=await fetch(url,{cache:"no-store",credentials:"include",...(body===undefined?{}:{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)})});
  const b=await r.json().catch(()=>({}));
  if(!r.ok || !b.ok) throw new Error(b.message || "Request could not be completed.");
  return b;
}
export default function OwnerRouteReviewsPage() {
  const [inquiries,setInquiries]=useState<Inquiry[]>([]);
  const [hasMore,setHasMore]=useState(false);
  const [ctx,setCtx]=useState<Context | null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [notes,setNotes]=useState("");
  const [ack,setAck]=useState(false);
  const [mapReady,setMapReady]=useState(false);
  const [price,setPrice]=useState("");
  const [validUntil,setValidUntil]=useState("");
  const [inclusions,setInclusions]=useState("");
  const [exclusions,setExclusions]=useState("");
  const [pricingNotes,setPricingNotes]=useState("");
  const [fuelNote,setFuelNote]=useState("");
  const [confirmQuote,setConfirmQuote]=useState(false);
  const selectionRef=useRef(0);
  const mutationRef=useRef(false);
  const mapReadyChanged=useCallback((v:boolean)=>setMapReady(v),[]);
  const loadList=useCallback(async()=>{
    const b=await request("/api/jfleet/owner/routes");
    setInquiries(b.inquiries || []); setHasMore(b.has_more===true);
  },[]);
  useEffect(()=>{ void loadList().catch(e=>setError(e.message)); return ()=>{selectionRef.current+=1;}; },[loadList]);
  async function open(inquiryId:string) {
    const generation=++selectionRef.current;
    setCtx(null); setMapReady(false); setAck(false); setNotes(""); setPrice(""); setValidUntil("");
    setInclusions(""); setExclusions(""); setPricingNotes(""); setFuelNote(""); setConfirmQuote(false); setError(""); setNotice("");
    try {
      const b=await request("/api/jfleet/owner/routes?inquiry_id="+encodeURIComponent(inquiryId));
      if(generation===selectionRef.current) setCtx(b);
    } catch(e) { if(generation===selectionRef.current) setError(e instanceof Error?e.message:"Could not load the route."); }
  }
  async function review(decision:Decision) {
    if(!ctx || mutationRef.current) return;
    mutationRef.current=true; setBusy(true); setError(""); setNotice("");
    const inquiryId=ctx.snapshot.inquiry_id;
    try {
      await request("/api/jfleet/owner/routes",{inquiry_id:inquiryId,snapshot_hash:ctx.snapshot_hash,decision,notes,acknowledged:ack});
      await open(inquiryId); await loadList();
      setNotice(decision==="approved"?"Route approved for quotation. This did not confirm a booking or verify any permit.":"Changes requested. Previous unaccepted quotations are withdrawn; they can no longer be accepted.");
    } catch(e) { setError(e instanceof Error?e.message:"Review failed."); setCtx(null); }
    finally { mutationRef.current=false; setBusy(false); }
  }
  async function sendQuote() {
    if(!ctx?.approved_review_id || !confirmQuote || mutationRef.current) return;
    if(!validUntil || !Number.isFinite(Number(price)) || Number(price)<=0 || !inclusions.trim() || !exclusions.trim()) {
      setError("Enter a price, validity time, inclusions and exclusions. Enter None when there are no exclusions."); return;
    }
    mutationRef.current=true; setBusy(true); setError(""); setNotice("");
    const inquiryId=ctx.snapshot.inquiry_id;
    try {
      const b=await request("/api/jfleet/owner/quotes",{
        inquiry_id:inquiryId,route_review_id:ctx.approved_review_id,total_amount:Number(price),
        valid_until:validUntil+":00+08:00",inclusions,exclusions,pricing_notes:pricingNotes,fuel_basis_note:fuelNote,items:[]
      });
      await open(inquiryId); await loadList();
      setNotice("Quotation v"+b.version_no+" saved and bound to the reviewed itinerary. This is not a paid reservation.");
    } catch(e) { setError(e instanceof Error?e.message:"Quotation failed."); setConfirmQuote(false); }
    finally { mutationRef.current=false; setBusy(false); }
  }
  const d=ctx?.snapshot.details;
  const reviewOpen=ctx && ["quote_requested","under_review","quote_ready","revision_requested"].includes(ctx.status) && Number(d?.start_epoch)*1000>Date.now();
  return <main className="min-h-screen bg-slate-100 p-4 sm:p-6 text-slate-950">
    <div className="mx-auto max-w-6xl space-y-5">
      <header className="rounded-2xl bg-slate-950 p-6 text-white"><h1 className="text-2xl font-bold">JFleet - Route review and quotations</h1>
        <p className="mt-2 text-sm">Owner access only. Inspect the saved road route and trip details before approving and pricing the hire.</p>
      </header>
      {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">{error}</p>}
      {notice && <p role="status" className="rounded-xl bg-emerald-50 p-4 text-emerald-900">{notice}</p>}
      <section className="rounded-2xl bg-white p-5">
        <div className="flex justify-between items-center gap-3"><h2 className="font-bold">Open inquiries</h2><button disabled={busy} className="border rounded-lg px-3 py-2" onClick={()=>void loadList().catch(e=>setError(e.message))}>Refresh</button></div>
        {!inquiries.length && <p className="mt-3">No open inquiries were loaded.</p>}
        {hasMore && <p className="mt-3 text-sm">Showing the first 50 inquiries by response deadline. More remain.</p>}
        <div className="mt-3 grid gap-3 sm:grid-cols-2">{inquiries.map(i=><button key={i.id} disabled={busy} onClick={()=>void open(i.id)} className="text-left border rounded-xl p-3 hover:bg-slate-50 disabled:opacity-50">
          <strong>{i.inquiry_code}</strong><p>{i.pickup_label} | {i.requested_vehicle_type}</p>
          <p className="text-sm">{i.status.replace(/_/g," ")} | Response due: {philippinesTime(i.quote_due_at)}</p>
        </button>)}</div>
      </section>
      {ctx && d && <section className="rounded-2xl bg-white p-5 space-y-5">
        <h2 className="text-xl font-bold">{ctx.inquiry_code} - Itinerary v{ctx.snapshot.itinerary_version}</h2>
        <p className="text-sm rounded-lg bg-amber-50 p-3">{REVIEW_NOTICE}</p>
        <div className="grid sm:grid-cols-2 gap-2 text-sm">
          <p><strong>Departure:</strong> {philippinesTime(Number(d.start_epoch)*1000)}</p><p><strong>Expected end:</strong> {philippinesTime(Number(d.end_epoch)*1000)}</p>
          <p><strong>Requested vehicle:</strong> {d.vehicle_type}</p><p><strong>Trip:</strong> {d.trip_mode.replace(/_/g," ")} | {d.purpose.replace(/_/g," ")}</p>
          <p><strong>Passengers:</strong> {d.passenger_count??"Not provided"}</p><p><strong>Cargo:</strong> {d.cargo_description||"Not provided"} | {d.cargo_weight_kg??"Unknown"} kg</p>
          <p><strong>Luggage:</strong> {d.luggage_notes||"None stated"}</p><p><strong>Customer notes:</strong> {d.special_notes||"None stated"}</p>
          <p><strong>Planned road distance:</strong> {(ctx.snapshot.route.distance_m/1000).toFixed(1)} km</p>
          <p><strong>Estimated driving time:</strong> {(ctx.snapshot.route.duration_s/3600).toFixed(1)} hours, excluding stops and overnight stays</p>
        </div>
        {ctx.map_token ? <RouteMap key={ctx.snapshot_hash} snapshot={ctx.snapshot} token={ctx.map_token} onReady={mapReadyChanged}/> : <p role="alert" className="text-red-700">Public map token is unavailable. Approval is disabled until the map can load.</p>}
        <div className="space-y-2">{ctx.snapshot.points.map((p,index)=><div key={index} className="border rounded-lg p-3 text-sm"><strong>{index+1}. {p.label}</strong><p>{p.lat.toFixed(6)}, {p.lng.toFixed(6)}</p>{p.notes && <p>{p.notes}</p>}</div>)}</div>
        {reviewOpen ? <div className="space-y-3 border-t pt-4">
          <label className="block text-sm">Review notes / required changes<textarea className={field+" mt-1"} rows={3} maxLength={1500} value={notes} onChange={e=>setNotes(e.target.value)}/></label>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)}/><span>{REVIEW_ACK}</span></label>
          <div className="flex flex-wrap gap-3"><button disabled={busy||!ack||!mapReady} className="bg-emerald-800 text-white rounded-lg px-4 py-3 disabled:opacity-50" onClick={()=>void review("approved")}>Approve route for quotation</button>
            <button disabled={busy||notes.trim().length<3} className="border rounded-lg px-4 py-3 disabled:opacity-50" onClick={()=>void review("changes_requested")}>Request changes</button></div>
          {!mapReady && <p className="text-sm text-amber-800">Map loading or unavailable. Review approval is not enabled.</p>}
        </div> : <p className="text-amber-800">This inquiry is no longer open for route approval or quotation.</p>}
        {ctx.approved_review_id && reviewOpen && <div className="border-t pt-5 space-y-3">
          <h3 className="text-lg font-bold">Issue quotation for this approved route</h3>
          <p className="text-sm">Fuel and other costs remain the owner's quotation. A different approval on another device will require you to reload before sending.</p>
          <div className="grid sm:grid-cols-2 gap-3">
            <label>Total quotation (PHP)<input className={field} type="number" min="0.01" step="0.01" value={price} onChange={e=>{setPrice(e.target.value);setConfirmQuote(false);}}/></label>
            <label>Valid until (Philippines time)<input className={field} type="datetime-local" value={validUntil} onChange={e=>{setValidUntil(e.target.value);setConfirmQuote(false);}}/></label>
            <label>Included<textarea className={field} value={inclusions} maxLength={2000} onChange={e=>{setInclusions(e.target.value);setConfirmQuote(false);}}/></label>
            <label>Excluded / customer-paid items<textarea className={field} value={exclusions} maxLength={2000} onChange={e=>{setExclusions(e.target.value);setConfirmQuote(false);}}/></label>
            <label>Fuel pricing basis<textarea className={field} value={fuelNote} maxLength={1000} onChange={e=>{setFuelNote(e.target.value);setConfirmQuote(false);}}/></label>
            <label>Other pricing terms<textarea className={field} value={pricingNotes} maxLength={2000} onChange={e=>{setPricingNotes(e.target.value);setConfirmQuote(false);}}/></label>
          </div>
          <label className="flex gap-2 text-sm"><input type="checkbox" checked={confirmQuote} onChange={e=>setConfirmQuote(e.target.checked)}/><span>I confirm this price and its inclusions/exclusions apply to the displayed approved itinerary.</span></label>
          <button disabled={busy||!confirmQuote} className="bg-slate-950 text-white rounded-lg px-4 py-3 disabled:opacity-50" onClick={()=>void sendQuote()}>Send reviewed quotation</button>
        </div>}
        <details className="border-t pt-4"><summary className="font-bold cursor-pointer">Review history (latest 20)</summary>
          {ctx.history.map(r=><div className="mt-3 border rounded-lg p-3 text-sm" key={r.id}><strong>{r.decision.replace(/_/g," ")}</strong><p>{philippinesTime(r.created_at)}</p><p>{r.notes||"No additional notes"}</p></div>)}
        </details>
      </section>}
    </div>
  </main>;
}
