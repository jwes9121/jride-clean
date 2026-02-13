import Link from "next/link";

export const dynamic = "force-dynamic";

type MenuItem = {
  id: string;
  name: string;
  price: number;
  desc?: string;
  photoUrl?: string; // premium only
};

function peso(n: number) {
  const v = Number(n || 0);
  return "â‚±" + v.toFixed(0);
}

function FeatureRow(props: { label: string; a: string; b: string }) {
  return (
    <div className="grid grid-cols-12 gap-3 py-2 border-t border-white/10">
      <div className="col-span-12 md:col-span-4 text-sm opacity-80">{props.label}</div>
      <div className="col-span-6 md:col-span-4 text-sm">{props.a}</div>
      <div className="col-span-6 md:col-span-4 text-sm">{props.b}</div>
    </div>
  );
}

function PlanCard(props: {
  title: string;
  plan: "FREE" | "PREMIUM";
  badge?: string;
  subtitle: string;
  bullets: string[];
  menu: MenuItem[];
}) {
  const premium = props.plan === "PREMIUM";

  return (
    <div
      className={
        "rounded-3xl border p-4 md:p-6 shadow-lg " +
        (premium ? "border-emerald-400/40 bg-emerald-500/5" : "border-white/10 bg-white/5")
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xl font-semibold">{props.title}</div>
          <div className="mt-1 text-sm opacity-70">{props.subtitle}</div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span
            className={
              "px-3 py-1 rounded-full text-xs font-semibold " +
              (premium ? "bg-emerald-500/20 text-emerald-200" : "bg-white/10 text-white/80")
            }
          >
            {props.plan}
          </span>
          {props.badge ? (
            <span className="px-3 py-1 rounded-full text-xs bg-white/10 text-white/80">
              {props.badge}
            </span>
          ) : null}
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-3">
        <div className="text-sm font-semibold">What customers see</div>

        {!premium ? (
          <div className="mt-3">
            <div className="text-xs opacity-70">Text-only menu (max 5)</div>
            <div className="mt-2 space-y-2">
              {props.menu.slice(0, 5).map((m) => (
                <div key={m.id} className="flex items-center justify-between gap-2">
                  <div className="text-sm">{m.name}</div>
                  <div className="text-sm font-semibold">{peso(m.price)}</div>
                </div>
              ))}
            </div>
            <div className="mt-3 text-xs opacity-70">
              Photos: <span className="font-semibold">Not available</span> on Free plan
            </div>
          </div>
        ) : (
          <div className="mt-3">
            <div className="text-xs opacity-70">Auto-zoom store + swipe photo menu</div>
            <div className="mt-2 flex gap-3 overflow-x-auto pb-2">
              {props.menu.map((m) => (
                <div
                  key={m.id}
                  className="min-w-[240px] max-w-[240px] rounded-2xl border border-white/10 bg-white/5 overflow-hidden"
                >
                  <div className="aspect-[16/10] bg-black/30">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={m.photoUrl} alt={m.name} className="h-full w-full object-cover" loading="lazy" />
                  </div>
                  <div className="p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-sm font-semibold leading-snug">{m.name}</div>
                      <div className="text-sm font-semibold">{peso(m.price)}</div>
                    </div>
                    {m.desc ? <div className="mt-1 text-xs opacity-70">{m.desc}</div> : null}
                    <button className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 py-2 text-xs">
                      Add to cart
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-2 text-xs opacity-70">
              Photos are automatically resized & compressed so uploads won't slow phones.
            </div>
          </div>
        )}
      </div>

      <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-3">
        <div className="text-sm font-semibold">What the vendor can do</div>
        <ul className="mt-2 space-y-1 text-sm">
          {props.bullets.map((b, i) => (
            <li key={i} className="flex gap-2">
              <span className="opacity-70">â€¢</span>
              <span className="opacity-90">{b}</span>
            </li>
          ))}
        </ul>

        <div className="mt-3 flex gap-2">
          {!premium ? (
            <>
              <button className="flex-1 rounded-xl border border-white/10 bg-white/5 py-2 text-sm opacity-70 cursor-not-allowed">
                Edit Menu (Premium)
              </button>
              <button className="flex-1 rounded-xl border border-emerald-400/30 bg-emerald-500/10 py-2 text-sm">
                Upgrade (Coming Soon)
              </button>
            </>
          ) : (
            <>
              <button className="flex-1 rounded-xl border border-white/10 bg-white/5 py-2 text-sm">
                Edit Menu
              </button>
              <button className="flex-1 rounded-xl border border-emerald-400/30 bg-emerald-500/10 py-2 text-sm">
                Manage Photos
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function VendorComparePage() {
  const freeMenu: MenuItem[] = [
    { id: "a1", name: "Chicken Rice Meal", price: 120 },
    { id: "a2", name: "Pancit Canton", price: 80 },
    { id: "a3", name: "Burger Steak", price: 95 },
    { id: "a4", name: "Lumpia (6pcs)", price: 50 },
    { id: "a5", name: "Softdrinks", price: 25 },
  ];

  const premiumMenu: MenuItem[] = [
    {
      id: "b1",
      name: "Chicken Rice Meal",
      price: 120,
      desc: "Fried chicken + garlic rice + gravy",
      photoUrl: "https://images.unsplash.com/photo-1604908554162-45f2b1aab4b8?auto=format&fit=crop&w=1200&q=70",
    },
    {
      id: "b2",
      name: "Pancit Canton",
      price: 80,
      desc: "Classic pancit, good for sharing",
      photoUrl: "https://images.unsplash.com/photo-1601050690597-df0568f70950?auto=format&fit=crop&w=1200&q=70",
    },
    {
      id: "b3",
      name: "Burger Steak",
      price: 95,
      desc: "Savory sauce + rice",
      photoUrl: "https://images.unsplash.com/photo-1550547660-d9450f859349?auto=format&fit=crop&w=1200&q=70",
    },
    {
      id: "b4",
      name: "Lumpia (6pcs)",
      price: 50,
      desc: "Crispy lumpia with dip",
      photoUrl: "https://images.unsplash.com/photo-1604909054103-f0f3b55bdac5?auto=format&fit=crop&w=1200&q=70",
    },
    {
      id: "b5",
      name: "Iced Coffee",
      price: 55,
      desc: "Not too sweet",
      photoUrl: "https://images.unsplash.com/photo-1511920170033-f8396924c348?auto=format&fit=crop&w=1200&q=70",
    },
  ];

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-6xl px-4 py-8 md:py-12">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-3xl md:text-4xl font-semibold">JRide Vendor</div>
            <div className="mt-2 text-sm md:text-base opacity-75">
              Start free. Upgrade when you're ready to manage your menu & photos yourself.
            </div>
          </div>
          <Link
            href="/vendor-orders"
            className="hidden md:inline-flex rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm"
          >
            Back to Vendor Orders
          </Link>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <PlanCard
            title="Vendor A - Free"
            plan="FREE"
            badge="Pilot / Starter"
            subtitle="Best for listing your best sellers fast"
            bullets={[
              "Up to 5 items (admin-encoded in pilot)",
              "Receive orders",
              "Text-only menu (fast, simple)",
              "No photos yet",
            ]}
            menu={freeMenu}
          />
          <PlanCard
            title="Vendor B - Premium"
            plan="PREMIUM"
            badge="Recommended â­"
            subtitle="Best for growing stores"
            bullets={[
              "Unlimited items",
              "Vendor login (self-manage menu)",
              "Upload photos per item",
              "Auto-resize + compress photos (prevents big uploads)",
              "Swipe photo menu (auto-zoom store view)",
            ]}
            menu={premiumMenu}
          />
        </div>

        <div className="mt-8 rounded-3xl border border-white/10 bg-white/5 p-4 md:p-6">
          <div className="text-lg font-semibold">Quick feature comparison</div>

          <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-3 md:p-4">
            <div className="grid grid-cols-12 gap-3 pb-2">
              <div className="col-span-12 md:col-span-4 text-sm opacity-70">Feature</div>
              <div className="col-span-6 md:col-span-4 text-sm font-semibold">Free</div>
              <div className="col-span-6 md:col-span-4 text-sm font-semibold">Premium</div>
            </div>

            <FeatureRow label="Menu items" a="Up to 5" b="Unlimited" />
            <FeatureRow label="Vendor can edit menu" a="No (admin-managed in pilot)" b="Yes (anytime)" />
            <FeatureRow label="Item photos" a="No" b="Yes (per item)" />
            <FeatureRow label="Auto photo resize + compression" a="No" b="Yes (automatic)" />
            <FeatureRow label="Customer swipe photo menu" a="No" b="Yes" />
          </div>

          <div className="mt-4 text-sm opacity-75">
            During the ride-feature launch, vendors can start Free. Premium becomes valuable once they want photos and full control.
          </div>
        </div>

        <div className="mt-6 text-xs opacity-60">
          Note: Photos on this demo page are placeholders. In production, uploads should be auto-optimized (WebP + thumbnails).
        </div>
      </div>
    </div>
  );
}
