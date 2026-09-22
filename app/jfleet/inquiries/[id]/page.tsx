"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { passengerAuthHeaders, passengerLoginHref, preparePassengerSession } from "@/lib/passenger/browserSession";
import { UUID, money } from "@/lib/jfleet/customer";
import type { CustomerContext } from "@/lib/jfleet/customer";
import { philippinesTime } from "@/lib/jfleet/routeReview";
const RouteMap=dynamic(()=>import("@/components/jfleet/ReviewedRouteMap"),{ssr:false,loading:()=> <p>Loading saved route map...</p>});
const readable=(s:string)=>s.replace(/_/g," ");
function SnapshotDetails({snapshot}:{snapshot:CustomerContext["snapshot"]}){
  const d=snapshot.details;
  return <section className="space-y-2 rounded-xl bg-slate-50 p-4 text-sm">
    <h3 className="font-bold">Quoted itinerary v{snapshot.itinerary_version}</h3>
    <p>Departure: {philippinesTime(d.start_epoch*1000)} | Expected end: {philippinesTime(d.end_epoch*1000)}</p>
    <p>Vehicle: {readable(d.vehicle_type)} | Trip: {readable(d.trip_mode)} | Purpose: {readable(d.purpose)}</p>
    <p>Passengers: {d.passenger_count??"Not specified"} | Cargo weight: {d.cargo_weight_kg===null?"Not specified":d.cargo_weight_kg+" kg"}</p>
    <p>Cargo: {d.cargo_description||"Not specified"}</p><p>Luggage: {d.luggage_notes||"Not specified"}</p><p>Special requirements: {d.special_notes||"None specified"}</p>
    <ol className="list-decimal space-y-2 pl-5">{snapshot.points.map((p,i)=><li key={i}><strong>{p.label}</strong><p>{p.lat.toFixed(6)}, {p.lng.toFixed(6)}</p>{p.notes?<p>{p.notes}</p>:null}</li>)}</ol>
    <p>Road-route estimate: {(snapshot.route.distance_m/1000).toFixed(1)} km, approximately {Math.ceil(snapshot.route.duration_s/60)} driving minutes. Stops and overnight stays are not included in driving time.</p>
  </section>;
}
export default function InquiryDetails({params}:{params:{id:string}}){
  const [data,setData]=useState<CustomerContext|null>(null),[error,setError]=useState(""),[message,setMessage]=useState("");
  const [loading,setLoading]=useState(true),[needLogin,setNeedLogin]=useState(false),[busy,setBusy]=useState(false);
  const [selected,setSelected]=useState(""),[ack,setAck]=useState(""),[mapReady,setMapReady]=useState(false),[now,setNow]=useState(Date.now());
  const generation=useRef(0),inFlight=useRef(false);
  const load=useCallback(async()=>{
    const version=++generation.current;setLoading(true);setError("");
    try{
      if(!UUID.test(params.id))throw new Error("Invalid inquiry.");
      const s=await preparePassengerSession();if(!s.authed){if(version===generation.current)setNeedLogin(true);return;}
      const r=await fetch("/api/jfleet/customer?id="+params.id,{headers:passengerAuthHeaders(),cache:"no-store"});const b=await r.json();
      if(!r.ok||!b.ok)throw new Error(b.message||"Inquiry details unavailable.");
      if(version===generation.current){setNeedLogin(false);setData(b);setSelected(old=>b.quotes.some((q:{id:string})=>q.id===old)?old:(b.actionable_quote_id||b.quotes[0]?.id||""));}
    }catch(e){if(version===generation.current)setError(e instanceof Error?e.message:"Inquiry details unavailable.");}
    finally{if(version===generation.current)setLoading(false);}
  },[params.id]);
  useEffect(()=>{setData(null);setAck("");setSelected("");void load();return()=>{generation.current++;};},[load]);
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),15000);return()=>clearInterval(timer);},[]);
  async function accept(){
    if(!data||inFlight.current)return;
    const q=data.quotes.find(q=>q.id===selected),binding=data.context_token+":"+selected;
    if(!q||data.actionable_quote_id!==q.id||ack!==binding||Date.parse(q.valid_until)<=Date.now())return;
    inFlight.current=true;setBusy(true);setError("");setMessage("");
    try{
      const r=await fetch("/api/jfleet/quotes/accept",{method:"POST",headers:passengerAuthHeaders(true),cache:"no-store",
        body:JSON.stringify({inquiry_id:data.inquiry_id,quote_id:q.id,context_token:data.context_token,terms_acknowledged:true})});
      const b=await r.json();if(!r.ok||!b.ok)throw new Error(b.message||"Could not accept this quotation.");
      setAck("");setMessage("Quotation accepted. "+b.booking_code+" is reservation pending. Minimum payment required: "+money(b.reservation_required_amount)+". Payment must be confirmed before the booking is reserved.");await load();
    }catch(e){setAck("");setError(e instanceof Error?e.message:"Could not accept this quotation. Reload to check its status.");}
    finally{inFlight.current=false;setBusy(false);}
  }
  if(needLogin)return <main className="p-6"><Link className="underline" href={passengerLoginHref("/jfleet/inquiries/"+params.id)}>Sign in to view this inquiry</Link></main>;
  if(!data)return <main className="p-6"><p role={error?"alert":undefined}>{error||(loading?"Loading full quotation details...":"Inquiry unavailable.")}</p><Link className="underline" href="/jfleet/inquiries">Back to inquiries</Link></main>;
  const quote=data.quotes.find(q=>q.id===selected)??null;
  const binding=data.context_token+":"+selected;
  const canAccept=!!quote&&quote.id===data.actionable_quote_id&&Date.parse(quote.valid_until)>now&&!data.booking;
  const terms=data.terms;
  return <main className="min-h-screen bg-slate-50 p-4 text-slate-950"><div className="mx-auto max-w-4xl space-y-5">
    <header className="rounded-2xl bg-slate-950 p-6 text-white"><p>JFleet / {data.partner_name}</p><h1 className="mt-2 break-all text-xl font-bold">{data.inquiry_code}</h1><p className="mt-2">{readable(data.status)} | Current itinerary v{data.snapshot.itinerary_version}</p></header>
    <div className="flex flex-wrap gap-3"><button type="button" disabled={busy||loading} onClick={()=>void load()} className="rounded-lg border bg-white px-4 py-2">{loading?"Refreshing...":"Refresh inquiry"}</button>{data.can_revise?<Link className="rounded-lg bg-emerald-800 px-4 py-2 font-semibold text-white" href={"/jfleet/inquiries/"+data.inquiry_id+"/revise"}>Revise itinerary / request new quote</Link>:null}</div>
    {error?<p role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">{error}</p>:null}{message?<p role="status" className="rounded-xl bg-emerald-50 p-4">{message}</p>:null}
    {data.booking?<section className="rounded-xl border border-emerald-300 bg-emerald-50 p-4"><strong>{data.booking.booking_code}: {readable(data.booking.status)}</strong><p>Payment: {readable(data.booking.payment_status)}. Original quote: {money(data.booking.original_quote_amount)}. Minimum reservation: {money(data.booking.reservation_required_amount)}.</p><p>Further changes must not overwrite this accepted inquiry.</p><Link className="underline" href="/jfleet">View booking</Link></section>:<p className="rounded-xl bg-amber-50 p-4">This is an inquiry, not a confirmed booking. Response due: {philippinesTime(data.quote_due_at)}. Revisions restart the {terms.quote_tat_minutes/60}-hour quotation response window.</p>}
    <details className="rounded-xl border bg-white p-4" open><summary className="cursor-pointer font-bold">Current requested route</summary><SnapshotDetails snapshot={data.snapshot} />{data.map_token?<><RouteMap key={data.snapshot.route_plan_id} snapshot={data.snapshot} token={data.map_token} onReady={setMapReady} /><p className="mt-2 text-xs">{mapReady?"Saved route displayed. This is not live tracking.":"Map not fully loaded; the ordered pin details remain available above."}</p></>:<p className="text-xs">Map display is unavailable. No substitute route is shown.</p>}</details>
    <section className="space-y-4 rounded-2xl border bg-white p-5"><h2 className="text-xl font-bold">Complete quotation</h2>
      {!data.quotes.length?<p>The owner has not sent a quotation for this inquiry.</p>:<>
        <label className="block">Quotation history<select value={selected} onChange={e=>{setAck("");setSelected(e.target.value);}} className="mt-2 w-full rounded-lg border p-3">{data.quotes.map(q=><option key={q.id} value={q.id}>Quote v{q.version_no} - {money(q.total_amount)} - {readable(q.display_status)}</option>)}</select></label>
        {quote?<>
          <div className="rounded-xl bg-slate-950 p-4 text-white"><p>Quote v{quote.version_no} / {readable(quote.display_status)}</p><h3 className="text-3xl font-bold">{money(quote.total_amount)}</h3><p>Valid until {philippinesTime(quote.valid_until)}</p></div>
          {quote.snapshot?<SnapshotDetails snapshot={quote.snapshot} />:<p>This historical quotation has no reviewed route snapshot.</p>}
          <div className="grid gap-4 sm:grid-cols-2"><div><h3 className="font-bold">Included</h3><p className="whitespace-pre-wrap">{quote.inclusions||"Not specified by the operator."}</p></div><div><h3 className="font-bold">Not included</h3><p className="whitespace-pre-wrap">{quote.exclusions||"Not specified by the operator."}</p></div><div><h3 className="font-bold">Fuel pricing basis</h3><p className="whitespace-pre-wrap">{quote.fuel_basis_note||"Not specified by the operator."}</p></div><div><h3 className="font-bold">Pricing notes</h3><p className="whitespace-pre-wrap">{quote.pricing_notes||"No additional notes."}</p></div></div>
          {quote.items.length?<div className="space-y-2"><h3 className="font-bold">Operator's price breakdown</h3>{quote.items.map(item=><div key={item.sequence_no} className="rounded-lg border p-3"><p>{item.label}: <strong>{money(item.amount)}</strong> - {item.included?"Included in quoted total":"Not included in quoted total"}</p>{item.notes?<p>{item.notes}</p>:null}</div>)}</div>:<p className="text-sm">The operator supplied a total price without an itemized breakdown. Do not assume unlisted expenses are included; request clarification before accepting.</p>}
          {canAccept?<section className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4"><h3 className="font-bold">Review before accepting</h3>
            <p>Minimum down payment ({terms.reservation_percent}%): <strong>{money(quote.reservation_required_amount)}</strong>.</p><p>Balance after that minimum payment: <strong>{money(Number(quote.total_amount)-Number(quote.reservation_required_amount))}</strong>. The original quotation must be fully paid before the trip starts.</p>
            <p>Cancel at least {terms.free_cancel_hours} hours before departure for a full refund of the amount paid. Cutoff: <strong>{philippinesTime(terms.free_cancel_until_epoch*1000)}</strong>.</p>
            <p>Cancellation after the cutoff but before departure forfeits <strong>{terms.late_cancel_percent}% of the total accepted quotation</strong>, not that percentage of the deposit. For this quotation: {money(Number(quote.total_amount)*terms.late_cancel_percent/100)}.</p>
            <p>Additional destinations during the trip require a separate approved additional charge. Accepting this quotation does not confirm a reservation until the required payment is confirmed.</p>
            <label className="flex gap-3"><input type="checkbox" checked={ack===binding} disabled={busy} onChange={e=>setAck(e.target.checked?binding:"")} /><span>I reviewed this quotation's itinerary, total, inclusions, exclusions and payment/cancellation terms.</span></label>
            <button type="button" disabled={busy||loading||ack!==binding} onClick={()=>void accept()} className="w-full rounded-lg bg-emerald-800 px-4 py-3 font-bold text-white disabled:opacity-50">{busy?"Accepting...":"Accept quote v"+quote.version_no+" - "+money(quote.total_amount)}</button>
          </section>:<p className="rounded-xl bg-slate-100 p-4">This quote is historical, expired, withdrawn, awaiting fresh owner approval or already accepted. It cannot be accepted from this screen.</p>}
        </>:null}
      </>}
    </section>
    <section className="space-y-3 rounded-2xl border bg-white p-5"><h2 className="text-xl font-bold">Owner feedback and revision history</h2>{!data.reviews.length&&!data.revisions.length?<p>No review decisions or revisions yet.</p>:null}
      {data.reviews.map(r=><div key={r.id} className="rounded-lg border p-3"><strong>Owner: {readable(r.decision)} / itinerary v{r.itinerary_version}</strong><p className="text-xs">{philippinesTime(r.created_at)}</p><p className="whitespace-pre-wrap">{r.notes||"No additional review notes."}</p></div>)}
      {data.revisions.map(r=><div key={r.id} className="rounded-lg border p-3"><strong>Your revision: v{r.from_version} to v{r.to_version}</strong><p className="text-xs">{philippinesTime(r.created_at)}</p><p className="whitespace-pre-wrap">{r.reason}</p></div>)}
    </section><Link className="block underline" href="/jfleet/inquiries">Back to all inquiries</Link>
  </div></main>;
}
