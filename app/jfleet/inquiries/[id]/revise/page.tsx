"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import CustomerItineraryEditor from "@/components/jfleet/CustomerItineraryEditor";
import type { CustomerContext } from "@/lib/jfleet/customer";
import { UUID } from "@/lib/jfleet/customer";
import { passengerAuthHeaders, passengerLoginHref, preparePassengerSession } from "@/lib/passenger/browserSession";
export default function ReviseInquiry({params}:{params:{id:string}}){
  const [data,setData]=useState<CustomerContext|null>(null),[error,setError]=useState(""),[needLogin,setNeedLogin]=useState(false);
  useEffect(()=>{let live=true;setData(null);setError("");setNeedLogin(false);
    (async()=>{try{
      if(!UUID.test(params.id))throw new Error("Invalid inquiry.");
      const session=await preparePassengerSession();if(!session.authed){if(live)setNeedLogin(true);return;}
      const r=await fetch("/api/jfleet/customer?id="+params.id,{headers:passengerAuthHeaders(),cache:"no-store"});const b=await r.json();
      if(!r.ok||!b.ok)throw new Error(b.message||"Inquiry unavailable.");if(!b.can_revise)throw new Error("This inquiry cannot be revised after acceptance, closure or departure.");if(live)setData(b);
    }catch(e){if(live)setError(e instanceof Error?e.message:"Inquiry unavailable.");}})();return()=>{live=false;};
  },[params.id]);
  if(needLogin)return <main className="p-6"><Link className="underline" href={passengerLoginHref("/jfleet/inquiries/"+params.id+"/revise")}>Sign in to revise your inquiry</Link></main>;
  if(error)return <main className="p-6"><p role="alert">{error}</p><Link className="underline" href="/jfleet/inquiries">Back to inquiries</Link></main>;
  if(!data)return <main className="p-6">Loading your current itinerary...</main>;
  return <CustomerItineraryEditor key={data.inquiry_id+data.context_token} seed={data} />;
}
