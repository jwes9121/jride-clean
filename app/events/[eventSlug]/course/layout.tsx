import type { Metadata } from "next";
import type { ReactNode } from "react";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const appUrl =
  process.env.NEXT_PUBLIC_APP_URL ||
  process.env.NEXT_PUBLIC_SITE_URL ||
  "https://app.jride.net";

function absoluteUrl(path: string) {
  return `${appUrl.replace(/\/$/, "")}${path}`;
}

export async function generateMetadata({
  params,
}: {
  params: {
    eventSlug: string;
  };
}): Promise<Metadata> {
  let eventName = "Official Fun Walk Course";
  let distance = "5.21";

  try {
    const supabase = supabaseAdmin();
    const { data: event } = await supabase
      .from("events")
      .select("id,name")
      .eq("slug", params.eventSlug)
      .maybeSingle();

    if (event?.name) {
      eventName = event.name;
    }

    if (event?.id) {
      const { data: route } = await supabase
        .from("event_course_routes")
        .select(
          "official_distance_km,measured_distance_km"
        )
        .eq("event_id", event.id)
        .maybeSingle();

      const routeDistance =
        route?.official_distance_km ??
        route?.measured_distance_km;

      if (routeDistance !== null && routeDistance !== undefined) {
        distance = String(Number(routeDistance));
      }
    }
  } catch {}

  const title =
    `${eventName} - Official ${distance} km Course | JRide Events`;
  const description =
    `View the official ${distance} km course. ` +
    "Powered by JRide Events - digital registration, QR attendance, live safety tracking, and raffle.";
  const canonical = absoluteUrl(
    `/events/${encodeURIComponent(
      params.eventSlug
    )}/course`
  );
  const image = absoluteUrl(
    "/events/b2001-fun-run-logo.png"
  );

  return {
    title,
    description,
    alternates: {
      canonical,
    },
    openGraph: {
      title,
      description,
      url: canonical,
      siteName: "JRide Events",
      type: "website",
      images: [
        {
          url: image,
          alt: `${eventName} - JRide Events`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image],
    },
  };
}

export default function CourseLayout({
  children,
}: {
  children: ReactNode;
}) {
  return children;
}