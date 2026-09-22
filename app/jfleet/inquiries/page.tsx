"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { passengerAuthHeaders, passengerLoginHref, preparePassengerSession } from "@/lib/passenger/browserSession";
import { philippinesTime } from "@/lib/jfleet/routeReview";
type Inquiry={id:string;inquiry_code:string;status:string;pickup_label:string;scheduled_start_at:string;current_itinerary_version:number};
export default function CustomerInquiries(){
  const [rows,setRows]=useState<Inquiry[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(""),[needLogin,setNeedLogin]=useState(false);
  useEffect(()=>{let live=true;(async()=>{try{
    const s=await preparePassengerSession();if(!s.authed){if(live)setNeedLogin(true);return;}
    const r=await fetch("/api/jfleet/customer",{headers:passengerAuthHeaders(),cache:"no-store"});const b=await r.json();
    if(!r.ok||!b.ok)throw new Error(b.message||"Could not load inquiries.");if(live)setRows(b.inquiries);
  }catch(e){if(live)setError(e instanceof Error?e.message:"Could not load inquiries.");}finally{if(live)setLoading(false);}})();return()=>{live=false;};},[]);
  return <main className="mx-auto max-w-4xl space-y-4 p-5"><h1 className="text-3xl font-bold">My JFleet inquiries</h1><p>Canvass, revise and review quotations here. Accepting a quote creates a reservation-pending booking; it does not reserve a vehicle until payment is confirmed.</p>
    <Link href="/jfleet/request" className="inline-block rounded-xl bg-slate-950 px-4 py-3 text-white">Request a new quote</Link>
    {needLogin?<Link className="block underline" href={passengerLoginHref("/jfleet/inquiries")}>Sign in to view your inquiries</Link>:loading?<p>Loading inquiries...</p>:error?<p role="alert">{error}</p>:!rows.length?<p>No inquiries yet.</p>:rows.map(q=><Link key={q.id} href={"/jfleet/inquiries/"+q.id} className="block rounded-xl border bg-white p-4"><strong>{q.inquiry_code}</strong><p>{q.pickup_label} | {philippinesTime(q.scheduled_start_at)}</p><p>{q.status.replace(/_/g," ")} | Itinerary v{q.current_itinerary_version}</p><span className="underline">View full quotation and revision history</span></Link>)}
    <p className="text-xs text-slate-600">Shows the latest 100 inquiries.</p><Link href="/jfleet" className="block underline">Back to JFleet bookings</Link>
  </main>;
}
