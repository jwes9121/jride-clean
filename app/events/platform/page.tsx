import * as React from "react";
import Image from "next/image";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "JRide Events | Powerful Event Management for All Kinds of Occasions",
  description:
    "JRide Events helps organizers manage registrations, ticketing, QR Event Passes, check-ins, tracking, raffles, distributions, and reporting - all from one platform.",
};

type Occasion = {
  label: string;
};

type FeatureCard = {
  title: string;
  description: string;
  bullets: string[];
  screenshotLabel: string;
  imageSrc: string;
  imageFit?: "cover" | "contain";
};

const occasions: Occasion[] = [
  { label: "Traditional & Cultural Occasions" },
  { label: "Weddings" },
  { label: "Birthdays" },
  { label: "Family Reunions" },
  { label: "Alumni Homecomings" },
  { label: "School Programs" },
  { label: "LGU Activities" },
  { label: "Sports Events" },
  { label: "Church Gatherings" },
  { label: "Corporate Events" },
  { label: "Community Programs" },
  { label: "Fundraisers" },
];

const features: FeatureCard[] = [
  {
    title: "Online Registration",
    description: "Individual, family, and group registration in one flow.",
    bullets: [
      "Primary + up to 3 guests per submission",
      "Independent Event Pass for every person",
      "Existing-registration detection",
    ],
    screenshotLabel: "Registration form",
    imageSrc: "/platform/registration.png",
  },
  {
    title: "Secure Ticket Validation",
    description:
      "Every ticket is validated and claimed atomically - no double-claims, no orphaned tickets.",
    bullets: [
      "Ticket number + private claim code",
      "Duplicate-ticket rejection within one submission",
      "Atomic claim transaction",
    ],
    screenshotLabel: "Ticket details form",
    imageSrc: "/platform/ticket-validation.png",
  },
  {
    title: "QR Event Passes",
    description: "Every attendee - primary or guest - gets their own scannable pass.",
    bullets: [
      "Unique QR per person",
      "Independent guest passes",
      "Downloadable and printable",
    ],
    screenshotLabel: "Event Pass",
    imageSrc: "/platform/event-pass.png",
  },
  {
    title: "Family & Guest Registration",
    description: "Register a whole party together while keeping every person's record separate.",
    bullets: [
      "Relationship tracking",
      "Guest-linked attendee records",
      "Party-level and per-person reporting",
    ],
    screenshotLabel: "Guest list on Event Pass",
    imageSrc: "/platform/guest-registration.png",
  },
  {
    title: "Family Reunion & Genealogy",
    description:
      "Build and preserve family relationships for reunion events with an interactive genealogy view.",
    bullets: [
      "Family tree view up to 5 generations",
      "Biological, spouse, full-sibling, and half-sibling branches",
      "Cross-family genealogy links with organizer-controlled corrections",
    ],
    screenshotLabel: "Five-generation family tree",
    imageSrc: "/platform/family-reunion-genealogy.png",
    imageFit: "contain",
  },
  {
    title: "Check-in Scanner",
    description: "Fast, full-screen QR validation at the gate.",
    bullets: [
      "Instant scan confirmation",
      "Duplicate check-in prevention",
      "Attendance logged in real time",
    ],
    screenshotLabel: "Scanner screen",
    imageSrc: "/platform/scanner.png",
  },
  {
    title: "Checkpoint Tracking",
    description: "Route-based checkpoint scanning for walks, runs, and multi-stop events.",
    bullets: [
      "Per-checkpoint passage records",
      "Live progress and timeline",
      "Missing-between-checkpoints detection",
    ],
    screenshotLabel: "Runner Progress panel",
    imageSrc: "/platform/runner-progress.png",
  },
  {
    title: "Command Center",
    description: "One live dashboard for organizers to monitor the whole event.",
    bullets: [
      "Live registration and check-in counts",
      "Runner safety lookup",
      "Checkpoint anomaly detection",
    ],
    screenshotLabel: "Command Center dashboard",
    imageSrc: "/platform/command-center.png",
  },
  {
    title: "Reports & Analytics",
    description: "Attendance, registration, and participation data, exportable on demand.",
    bullets: [
      "Attendance and participation breakdowns",
      "Registration source tracking",
      "CSV export",
    ],
    screenshotLabel: "Reports panel",
    imageSrc: "/platform/reports.png",
  },
  {
    title: "Raffle System",
    description: "A secure, auditable draw with a built-in winner animation.",
    bullets: [
      "Checked-in-only eligibility option",
      "Full draw history",
      "Tamper-resistant selection",
    ],
    screenshotLabel: "Raffle draw screen",
    imageSrc: "/platform/raffle.png",
  },
  {
    title: "Distribution",
    description: "Track claim-based distributions like household goods or meals.",
    bullets: [
      "Household validation",
      "Claim-stub tracking",
      "Distribution reporting",
    ],
    screenshotLabel: "Distribution claim screen",
    imageSrc: "/platform/distribution.png",
  },
];

const outcomes = [
  {
    title: "Less paperwork",
    description:
      "Move registration, attendance, tickets, and reports into one digital workflow.",
  },
  {
    title: "Faster registration",
    description:
      "Let attendees register before event day and arrive with a ready Event Pass.",
  },
  {
    title: "Fewer duplicate claims",
    description:
      "Use QR passes, ticket status, and private claim codes to reduce repeat use.",
  },
  {
    title: "Real-time visibility",
    description:
      "Give organizers live operational information instead of waiting for manual tallies.",
  },
  {
    title: "Better attendee experience",
    description:
      "Give each person a clear pass, status, and participation information on mobile.",
  },
  {
    title: "Cleaner reporting",
    description:
      "Keep structured attendance and participation records ready for export and review.",
  },
];

const whyChoose = [
  "Fast online registration",
  "QR-based verification",
  "Secure ticket validation",
  "Guest & family management",
  "Live dashboards",
  "Real-time attendance",
  "Mobile-first design",
  "Built for events of every size",
];

const perfectFor = [
  "Schools",
  "LGUs",
  "Companies",
  "NGOs",
  "Churches",
  "Alumni Associations",
  "Sports Organizations",
  "Festivals",
  "Traditional Celebrations",
  "Community Events",
  "Private Occasions",
];

function PlatformPreview({
  label,
  imageSrc,
  imageFit = "cover",
}: {
  label: string;
  imageSrc: string;
  imageFit?: "cover" | "contain";
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-950">
      <div className="flex items-center gap-2 border-b border-slate-800 px-3 py-2">
        <span className="h-2 w-2 rounded-full bg-red-400" />
        <span className="h-2 w-2 rounded-full bg-amber-300" />
        <span className="h-2 w-2 rounded-full bg-emerald-400" />
        <span className="ml-2 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
          Platform preview
        </span>
      </div>

      <div className="relative aspect-[4/3] w-full bg-slate-950">
        <Image
          src={imageSrc}
          alt={`${label} preview`}
          fill
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
          className={
            imageFit === "contain"
              ? "object-contain object-center"
              : "object-cover object-top"
          }
        />
      </div>
    </div>
  );
}

export default function JRideEventsPlatformPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-white">
      {/* Hero */}
      <section className="px-4 py-12 sm:py-16">
        <div className="mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-amber-300">
              JRide Events
            </p>
            <h1 className="mt-4 text-4xl font-black leading-tight sm:text-5xl">
              Powerful Event Management for All Kinds of Occasions
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300">
              Built for traditional and cultural occasions, weddings,
              birthdays, reunions, school programs, sports events, government
              activities, fundraisers, corporate functions, church gatherings,
              and community celebrations - all from one powerful platform.
            </p>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-400">
              Manage registration, ticket validation, QR Event Passes,
              check-ins, checkpoint tracking, raffles, distributions, and
              reporting without stitching together separate tools.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a
                href="#contact"
                className="rounded-2xl bg-amber-400 px-6 py-4 text-center font-black text-slate-950"
              >
                Request a Live Demo
              </a>
              <a
                href="#features"
                className="rounded-2xl border border-slate-700 px-6 py-4 text-center font-bold text-white"
              >
                Explore Platform Features
              </a>
            </div>
          </div>

          <div className="overflow-hidden rounded-[2rem] border border-slate-800 bg-slate-900 shadow-2xl">
            <div className="relative aspect-[4/3] w-full bg-slate-950">
              <Image
                src="/events/b2001-fun-run-logo.png"
                alt="JRide Events featured event"
                fill
                priority
                sizes="(max-width: 1024px) 100vw, 520px"
                className="object-contain"
              />
            </div>
            <div className="border-t border-slate-800 p-5">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-amber-300">
                Real platform workflow
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                Registration, ticket validation, Event Passes, attendance,
                checkpoint tracking, and event operations are already built
                into JRide Events.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Perfect For */}
      <section className="border-t border-slate-900 bg-slate-900/40 px-4 py-14">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-center text-2xl font-black sm:text-3xl">
            Trusted for All Kinds of Occasions
          </h2>

          <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {occasions.map((occasion) => (
              <div
                key={occasion.label}
                className="rounded-2xl border border-slate-800 bg-slate-950 p-4 text-center"
              >
                <p className="text-sm font-bold text-slate-200">
                  {occasion.label}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Platform Features */}
      <section id="features" className="px-4 py-16">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-center text-2xl font-black sm:text-3xl">
            Everything You Need to Run a Successful Event
          </h2>
          <p className="mt-3 text-center text-slate-400">
            One platform, from registration to reporting.
          </p>

          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((feature) => (
              <div
                key={feature.title}
                className="rounded-3xl border border-slate-800 bg-slate-900 p-5"
              >
                <PlatformPreview
                  label={feature.screenshotLabel}
                  imageSrc={feature.imageSrc}
                  imageFit={feature.imageFit}
                />

                <h3 className="mt-4 text-lg font-black">{feature.title}</h3>
                <p className="mt-2 text-sm text-slate-400">
                  {feature.description}
                </p>

                <ul className="mt-3 space-y-1">
                  {feature.bullets.map((bullet) => (
                    <li
                      key={bullet}
                      className="flex items-start gap-2 text-sm text-slate-300"
                    >
                      <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-300" />
                      {bullet}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Organizer Outcomes */}
      <section className="border-y border-slate-900 bg-slate-900/40 px-4 py-16">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-center text-2xl font-black sm:text-3xl">
            What JRide Events Helps Organizers Achieve
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-center text-slate-400">
            The value is not another dashboard. It is a cleaner, faster event
            operation for organizers and attendees.
          </p>

          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {outcomes.map((outcome) => (
              <div
                key={outcome.title}
                className="rounded-2xl border border-slate-800 bg-slate-950 p-5"
              >
                <h3 className="font-black text-white">{outcome.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  {outcome.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Why Organizers Choose JRide Events */}
      <section className="border-t border-slate-900 bg-slate-900/40 px-4 py-16">
        <div className="mx-auto max-w-4xl">
          <h2 className="text-center text-2xl font-black sm:text-3xl">
            Why Organizers Choose JRide Events
          </h2>

          <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {whyChoose.map((reason) => (
              <div
                key={reason}
                className="flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-950 p-4"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100 text-sm font-black text-amber-800">
                  OK
                </span>
                <p className="font-bold text-white">{reason}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Perfect For (organization types) */}
      <section className="px-4 py-16">
        <div className="mx-auto max-w-4xl">
          <h2 className="text-center text-2xl font-black sm:text-3xl">
            Perfect For
          </h2>

          <div className="mt-8 flex flex-wrap justify-center gap-2">
            {perfectFor.map((item) => (
              <span
                key={item}
                className="rounded-full border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-bold text-slate-200"
              >
                {item}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section
        id="contact"
        className="border-t border-slate-900 bg-slate-900/40 px-4 py-16 text-center"
      >
        <div className="mx-auto max-w-3xl rounded-[2rem] border border-amber-300/30 bg-gradient-to-br from-amber-300/10 via-slate-900 to-slate-950 p-8 sm:p-10">
          <p className="text-xs font-black uppercase tracking-[0.25em] text-amber-300">
            JRide Events
          </p>
          <h2 className="mt-4 text-3xl font-black sm:text-4xl">
            Planning an Event?
          </h2>
          <p className="mx-auto mt-4 max-w-2xl leading-7 text-slate-300">
            Let us show you how JRide Events can simplify registration,
            ticketing, QR passes, check-ins, tracking, and reporting for your
            next traditional celebration, wedding, reunion, school activity,
            sports event, LGU program, fundraiser, corporate gathering, church
            event, or any other kind of occasion.
          </p>

          <div className="mt-8 rounded-2xl border border-slate-800 bg-slate-950/70 p-5">
            <p className="text-lg font-black text-white">
              Ready to plan your event?
            </p>
            <p className="mt-1 text-sm text-slate-400">
              Talk to our JRide Events Sales Team.
            </p>

            <div className="mt-4 flex flex-col justify-center gap-3 sm:flex-row">
              <a
                href="tel:+639173052981"
                className="rounded-xl bg-amber-400 px-5 py-3 text-sm font-black text-slate-950"
              >
                Call / Text: 0917 305 2981
              </a>

              <a
                href="mailto:info@jride.net"
                className="rounded-xl border border-slate-700 px-5 py-3 text-sm font-bold text-white"
              >
                Email: info@jride.net
              </a>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

