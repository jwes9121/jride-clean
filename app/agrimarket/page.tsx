"use client";

import StoreProfile, { type StoreIdentity } from "./StoreProfile";
import StoreAvailabilityNotice from "./StoreAvailabilityNotice";
import { CLOSED_CATALOG_VERSION, isStoreUnavailable, listingAvailability, productOrderBlocker, type StoreAvailability } from "@/lib/agrimarket/storeAvailability";
import { cartConflict, cargoGroupLabel } from "@/lib/agrimarket/cartCompatibility";
import { lineCents, moneyFromCents } from "@/lib/agrimarket/checkoutMoney";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ProductPhoto } from "./ProductPhoto";
import { scheduledTitle } from "@/lib/agrimarket/schedule";
import {
  passengerAuthHeaders,
  passengerLoginHref,
  preparePassengerSession,
  signOutPassenger,
  type PassengerSession,
} from "@/lib/passenger/browserSession";

type AddressRow = {
  id: string;
  label: string;
  address_text: string;
  landmark?: string | null;
  has_valid_pin: boolean;
  is_primary: boolean;
};

type SearchArea = "near_me" | "my_town" | "nearby_towns" | "all_ifugao";
type SortMode = "closest_recommended" | "lowest_price" | "availability" | "price_distance";

type ProductRow = Partial<StoreAvailability> & {
  id: string;
  name: string;
  photo_urls?: string[];
  producer_alias: string;
  producer_town?: string | null;
  proximity_rank: number;
  cart_group_key: string;
  harvest_window_key: string;
  road_distance_km?: number | null;
  road_duration_minutes?: number | null;
  approximate_road_distance_km?: number | null;
  approximate_road_duration_minutes?: number | null;
  is_cross_town?: boolean;
  cross_town_notice_required?: boolean;
  description?: string | null;
  product_group: string;
  species?: string | null;
  breed?: string | null;
  meat_cut?: string | null;
  processing_form?: string | null;
  condition: string;
  cargo_class: string;
  selling_unit: string;
  unit_price: number;
  unit_weight_kg?: number | null;
  remaining_quantity: number;
  availability_mode: "always_available" | "scheduled_harvest";
  harvest_start_at?: string | null;
  harvest_end_at?: string | null;
  harvest_order_cutoff_at?: string | null;
  preparation_minutes: number;
  vehicle_requirement: string;
  handling_eligible: boolean;
  can_order_now: boolean;
  order_action?: string | null;
  order_blocker?: string | null;
};

type CartLine = { product: ProductRow; quantity: number };
type AgrimarketVehicle = "motorcycle" | "tricycle" | "kolong_kolong";

function vehicleRank(value: unknown): number {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "kolong_kolong") return 3;
  if (raw === "tricycle") return 2;
  if (raw === "motorcycle") return 1;
  return 0;
}

function authHeaders(json = false): Record<string, string> {
  return passengerAuthHeaders(json);
}

function money(value: unknown): string {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? `PHP ${amount.toFixed(2)}` : "Amount unavailable";
}

function cartLineAmount(line: CartLine): number {
  try { return moneyFromCents(lineCents(line.product.unit_price, line.quantity)); }
  catch { return Number.NaN; }
}
function cartProductsAmount(lines: CartLine[]): number {
  try { return moneyFromCents(lines.reduce((sum, line) => sum + lineCents(line.product.unit_price, line.quantity), BigInt(0))); }
  catch { return Number.NaN; }
}

function formatDate(value: unknown): string {
  if (!value) return "-";
  const date = new Date(String(value));
  return Number.isFinite(date.getTime())
    ? date.toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" })
    : "-";
}

function titleCase(value: unknown): string {
  const raw = String(value || "").trim();
  if (raw.toLowerCase() === "kolong_kolong") return "Kolong-Kolong";
  return raw.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function isDemoProductName(value: unknown): boolean {
  return /^DEMO(?:\s|[-:])/i.test(String(value || "").trim());
}

function exactRoadDistance(value: unknown): string {
  const distance = Number(value);
  return Number.isFinite(distance) ? `${distance} km` : "Distance unavailable";
}

function normalized(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return 1;
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return 0;
  return (value - min) / (max - min);
}

export default function AgrimarketPage() {
  const availabilityRequest = useRef(0);
  const cartScope = useRef("");
  const checkoutAttempt = useRef<{ body: string; id: string } | null>(null);
  const [addresses, setAddresses] = useState<AddressRow[]>([]);
  const [addressId, setAddressId] = useState("");
  const [deliveryTown, setDeliveryTown] = useState<string | null>(null);
  const [deliveryTownResolved, setDeliveryTownResolved] = useState(false);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [preferredVehicle, setPreferredVehicle] = useState<AgrimarketVehicle>("motorcycle");
  const [quote, setQuote] = useState<any>(null);
  const [placed, setPlaced] = useState<any>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [searchArea, setSearchArea] = useState<SearchArea>("near_me");
  const [sortMode, setSortMode] = useState<SortMode>("closest_recommended");
  const [exploreOpen, setExploreOpen] = useState(false);
  const [storeProductId, setStoreProductId] = useState<string | null>(null);
  const [storeNames, setStoreNames] = useState<Record<string, StoreIdentity>>({});
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [crossTownPending, setCrossTownPending] = useState<ProductRow | null>(null);
  const [crossTownApprovals, setCrossTownApprovals] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [quoting, setQuoting] = useState(false);
  const [ordering, setOrdering] = useState(false);
  const [disabled, setDisabled] = useState(false);
  const [error, setError] = useState("");
  const [cartMessage, setCartMessage] = useState("");
  const [session, setSession] = useState<PassengerSession | null>(null);

  cartScope.current = `${addressId}|${cart[0]?.product.cart_group_key || ""}`;
  useEffect(() => { void initialize(); }, []);

  async function initialize() {
    setLoading(true);
    setError("");
    setDisabled(false);
    try {
      const currentSession = await preparePassengerSession();
      setSession(currentSession);
      if (currentSession.error || currentSession.authed !== true) return;

      const statusRes = await fetch("/api/agrimarket/status", { cache: "no-store" });
      const status = await statusRes.json().catch(() => ({}));
      if (!status?.enabled) {
        setDisabled(true);
        return;
      }

      const addressRes = await fetch("/api/agrimarket/addresses", { cache: "no-store", headers: authHeaders() });
      const addressPayload = await addressRes.json().catch(() => ({}));
      if (addressRes.status === 401) {
        setSession({ ...currentSession, authed: false });
        return;
      }
      if (!addressRes.ok || addressPayload?.ok === false) {
        setError(addressPayload?.message || addressPayload?.error || "Unable to load delivery addresses.");
        return;
      }
      const rows: AddressRow[] = Array.isArray(addressPayload?.addresses) ? addressPayload.addresses : [];
      setAddresses(rows);
      const selected = rows.find((row) => row.is_primary && row.has_valid_pin) || rows.find((row) => row.has_valid_pin);
      if (selected) {
        setAddressId(selected.id);
        await loadCatalog(selected.id);
      }
    } catch (error: any) {
      setError(String(error?.message || "Unable to load Agrimarket."));
    } finally {
      setLoading(false);
    }
  }

  async function loadCatalog(nextAddressId: string) {
    availabilityRequest.current += 1;
    setError("");
    setQuote(null);
    setPlaced(null);
    setCart([]);
    setCartMessage("");
    setSelectedProductId(null);
    setStoreProductId(null);
    setStoreNames({});
    setCrossTownPending(null);
    setCrossTownApprovals({});
    setSearchArea("near_me");
    setSortMode("closest_recommended");
    setExploreOpen(false);
    setDeliveryTown(null);
    setDeliveryTownResolved(false);
    if (!nextAddressId) return setProducts([]);
    const params = new URLSearchParams({ address_id: nextAddressId, store_visibility: CLOSED_CATALOG_VERSION });
    const response = await fetch(`/api/agrimarket/catalog?${params.toString()}`, { cache: "no-store", headers: authHeaders() });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok === false) {
      setProducts([]);
      setError(payload?.message || payload?.error || "Unable to load Agrimarket products.");
      return;
    }
    if (response.status === 401) {
    setSession((current) => (current ? { ...current, authed: false } : { authed: false }));
    setProducts([]);
    return;
  }
  const town = String(payload?.address?.town || "").trim();
    setDeliveryTown(town || null);
    setDeliveryTownResolved(payload?.address?.town_resolution === "resolved" && Boolean(town));
    setProducts(Array.isArray(payload?.products) ? payload.products : []);
  }

  const visibleProducts = useMemo(() => {
    const q = query.trim().toLowerCase();
    let rows = products.filter((product) => {
      if (category !== "all" && product.product_group !== category) return false;
      if (
        q &&
        !`${product.name} ${product.species || ""} ${product.breed || ""} ${product.producer_alias} ${product.producer_town || ""}`
          .toLowerCase()
          .includes(q)
      ) return false;

      if (searchArea === "my_town") return Boolean(deliveryTown && !product.is_cross_town);
      if (searchArea === "nearby_towns") return Boolean(deliveryTown && product.is_cross_town);
      return true;
    });

    const priceValues = rows.map((product) => Number(product.unit_price)).filter(Number.isFinite);
    const distanceValues = rows.map((product) => Number(product.road_distance_km)).filter(Number.isFinite);
    const minPrice = priceValues.length ? Math.min(...priceValues) : 0;
    const maxPrice = priceValues.length ? Math.max(...priceValues) : 0;
    const minDistance = distanceValues.length ? Math.min(...distanceValues) : 0;
    const maxDistance = distanceValues.length ? Math.max(...distanceValues) : 0;

    rows = [...rows].sort((a, b) => {
      if (a.can_order_now !== b.can_order_now) return a.can_order_now ? -1 : 1;
      const ad = Number(a.road_distance_km);
      const bd = Number(b.road_distance_km);
      const distanceA = Number.isFinite(ad) ? ad : Number.POSITIVE_INFINITY;
      const distanceB = Number.isFinite(bd) ? bd : Number.POSITIVE_INFINITY;

      if (sortMode === "lowest_price") {
        if (a.unit_price !== b.unit_price) return a.unit_price - b.unit_price;
        return distanceA - distanceB;
      }
      if (sortMode === "availability") {
        if (a.can_order_now !== b.can_order_now) return a.can_order_now ? -1 : 1;
        if (a.remaining_quantity !== b.remaining_quantity) return b.remaining_quantity - a.remaining_quantity;
        return distanceA - distanceB;
      }
      if (sortMode === "price_distance") {
        const aScore = normalized(a.unit_price, minPrice, maxPrice) + normalized(distanceA, minDistance, maxDistance);
        const bScore = normalized(b.unit_price, minPrice, maxPrice) + normalized(distanceB, minDistance, maxDistance);
        if (aScore !== bScore) return aScore - bScore;
        return distanceA - distanceB;
      }
      if (distanceA !== distanceB) return distanceA - distanceB;
      if (a.proximity_rank !== b.proximity_rank) return a.proximity_rank - b.proximity_rank;
      return a.unit_price - b.unit_price;
    });

    return rows;
  }, [products, query, category, searchArea, sortMode, deliveryTown]);

  const selectedProduct = useMemo(
    () => products.find((product) => product.id === selectedProductId) || null,
    [products, selectedProductId]
  );

  const moreFromSelectedFarmer = useMemo(() => {
    if (!selectedProduct) return [];
    return products
      .filter(
        (product) =>
          product.id !== selectedProduct.id &&
          product.cart_group_key === selectedProduct.cart_group_key
      )
      .sort((a, b) => {
        const byName = a.name.localeCompare(b.name);
        if (byName !== 0) return byName;
        if (a.proximity_rank !== b.proximity_rank) return a.proximity_rank - b.proximity_rank;
        return a.unit_price - b.unit_price;
      });
  }, [products, selectedProduct]);

  const storeProduct = products.find(product => product.id === storeProductId) || null;
  const storeProducts = storeProduct ? products.filter(product => product.cart_group_key === storeProduct.cart_group_key) : [];
  const cartStore = cart.length ? storeNames[cart[0].product.cart_group_key] : null;
  const cartError = cart.map(line => productOrderBlocker(line.product)).find(Boolean) || cartConflict(cart.map(line => line.product));
  const cartWeight = cart.length && cart.every(line => Number(line.product.unit_weight_kg) > 0)
    ? Math.round(cart.reduce((sum, line) => sum + Number(line.product.unit_weight_kg) * line.quantity, 0) * 1000) / 1000 : null;

  useEffect(() => {
    if (storeProductId) document.getElementById("agrimarket-store")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [storeProductId]);

  function reviewCart() {
    document.getElementById("agrimarket-cart")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function addStoreItem(id: string, store: StoreIdentity) {
    const product = storeProducts.find(row => row.id === id);
    if (!product || quoting || ordering) return;
    setStoreNames(current => ({ ...current, [product.cart_group_key]: store }));
    addToCart(product);
  }

  const cartSubtotal = useMemo(
    () => cartProductsAmount(cart),
    [cart]
  );
  const cartRequiredVehicle = useMemo(() => {
    let required: "either" | AgrimarketVehicle = "either";
    for (const line of cart) {
      if (vehicleRank(line.product.vehicle_requirement) > vehicleRank(required)) {
        required = String(line.product.vehicle_requirement || "either")
          .trim()
          .toLowerCase() as "either" | AgrimarketVehicle;
      }
    }
    return required;
  }, [cart]);
  const cartMode = cart[0]?.product.availability_mode || null;
  const cartHarvest = cartMode === "scheduled_harvest" ? cart[0]?.product : null;
  const cartCrossTownProduct = cart.find((line) => line.product.is_cross_town)?.product || null;

  useEffect(() => {
    if (vehicleRank(preferredVehicle) >= vehicleRank(cartRequiredVehicle)) return;
    setPreferredVehicle(
      cartRequiredVehicle === "kolong_kolong" ? "kolong_kolong" : "tricycle"
    );
  }, [cartRequiredVehicle, preferredVehicle]);

  function openProduct(product: ProductRow) {
    setStoreProductId(null);
    setSelectedProductId(product.id);
  }

  function crossTownKey(product: ProductRow): string {
    return `${addressId}|${product.cart_group_key}`;
  }

  function comparisonHint(product: ProductRow): string | null {
    if (!product.can_order_now) return null;
    const sameProduct = products.filter((row) => row.can_order_now && row.name.trim().toLowerCase() === product.name.trim().toLowerCase());
    if (!sameProduct.length) return null;
    const nearest = [...sameProduct].sort((a, b) => Number(a.road_distance_km || Infinity) - Number(b.road_distance_km || Infinity))[0];
    const lowest = [...sameProduct].sort((a, b) => a.unit_price - b.unit_price || Number(a.road_distance_km || Infinity) - Number(b.road_distance_km || Infinity))[0];
    if (nearest?.id === product.id && lowest?.id === product.id) return "Closest and lowest product price";
    if (nearest?.id === product.id) return "Closest option";
    if (lowest?.id === product.id) return "Lowest product price";
    if (
      nearest &&
      product.unit_price < nearest.unit_price &&
      Number(product.road_distance_km) > Number(nearest.road_distance_km)
    ) return "Lower product price, but farther delivery";
    return product.is_cross_town ? "Cross-town option" : null;
  }

  function addToCartConfirmed(product: ProductRow) {
    if (quoting || ordering) return;
    setCartMessage("");
    setQuote(null);
    setPlaced(null);
    const blocker = productOrderBlocker(product);
    if (blocker) { setCartMessage(blocker); return; }
    if (cart.length) {
      const first = cart[0].product;
      if (first.cart_group_key !== product.cart_group_key) {
        setCartMessage("This product is from another farmer. Finish this farmer's order or clear the cart first.");
        return;
      }
      if (first.availability_mode !== product.availability_mode) {
        setCartMessage("Always available products and scheduled reservations cannot be combined in one order.");
        return;
      }
      if (product.availability_mode === "scheduled_harvest" && first.harvest_window_key !== product.harvest_window_key) {
        setCartMessage("Scheduled products can share one cart only when they have the same preparation window.");
        return;
      }
    }

    const conflict = cartConflict([...cart.map(line => line.product), product]);
    if (conflict) { setCartMessage(conflict); return; }
    setCartMessage(`${product.name} added to this store's cart.`);
    setCart((current) => {
      const existing = current.find((line) => line.product.id === product.id);
      if (existing) {
        return current.map((line) =>
          line.product.id === product.id
            ? { ...line, quantity: Math.min(line.quantity + 1, product.remaining_quantity) }
            : line
        );
      }
      return [...current, { product, quantity: Math.min(1, product.remaining_quantity) }];
    });
  }

  function addToCart(product: ProductRow) {
    const blocker = productOrderBlocker(product);
    if (blocker) { setCartMessage(blocker); return; }
    if (quoting || ordering) return;
    setCartMessage("");
    if (!deliveryTownResolved || !deliveryTown) {
      setCartMessage("JRide could not confirm the municipality of this delivery pin. Re-select or update the delivery pin before adding an Agrimarket item.");
      return;
    }
    if (!String(product.producer_town || "").trim()) {
      setCartMessage("This farmer's municipality is not available for cross-town validation yet.");
      return;
    }
    if (product.cross_town_notice_required && !crossTownApprovals[crossTownKey(product)]) {
      setCrossTownPending(product);
      window.requestAnimationFrame(() => document.getElementById("agrimarket-cross-town")?.scrollIntoView({ behavior: "smooth", block: "start" }));
      return;
    }
    addToCartConfirmed(product);
  }

  function continueCrossTown() {
    if (!crossTownPending) return;
    const product = crossTownPending;
    const key = crossTownKey(product);
    setCrossTownApprovals((current) => ({ ...current, [key]: true }));
    setCrossTownPending(null);
    addToCartConfirmed(product);
  }

  function viewCloserOptions() {
    if (!crossTownPending) return;
    const productName = crossTownPending.name;
    setStoreProductId(null);
    setSelectedProductId(null);
    setCrossTownPending(null);
    setExploreOpen(true);
    setSearchArea("near_me");
    setSortMode("closest_recommended");
    setQuery(productName);
    if (typeof window !== "undefined") {
      window.requestAnimationFrame(() => document.getElementById("agrimarket-search")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  }

  function openExplore() {
    setStoreProductId(null);
    setExploreOpen(true);
    setSearchArea(deliveryTownResolved ? "nearby_towns" : "all_ifugao");
    setSortMode("closest_recommended");
  }

  function closeExplore() {
    setExploreOpen(false);
    setSearchArea("near_me");
    setSortMode("closest_recommended");
  }

  function updateQuantity(productId: string, value: number) {
    if (quoting || ordering) return;
    setQuote(null);
    setPlaced(null);
    setCart((current) => current
      .map((line) => line.product.id === productId
        ? { ...line, quantity: Math.min(Math.max(value, 0), line.product.remaining_quantity) }
        : line)
      .filter((line) => line.quantity > 0));
  }

  function clearCart() {
    if (quoting || ordering) return;
    setCart([]);
    setQuote(null);
    setPlaced(null);
    setCartMessage("");
  }

  function cartPayload() {
    return cart.map((line) => ({ product_id: line.product.id, quantity: line.quantity }));
  }

  async function refreshCartStore(): Promise<boolean> {
    if (!cart.length) return false;
    const request = ++availabilityRequest.current;
    const scope = cartScope.current;
    const first = cart[0].product;
    try {
      const params = new URLSearchParams({ product_id: first.id, store_visibility: CLOSED_CATALOG_VERSION });
      const response = await fetch(`/api/agrimarket/store?${params}`, { cache: "no-store", headers: authHeaders(), signal: AbortSignal.timeout(10000) });
      const body = await response.json().catch(() => ({}));
      if (request !== availabilityRequest.current || scope !== cartScope.current) return false;
      const status = response.ok ? body?.store?.store_status : "unavailable";
      const store = { accepting_orders: status === "open" || status === "closed", store_open: status === "open" };
      const update = (product: ProductRow): ProductRow => product.cart_group_key !== first.cart_group_key ? product : {
        ...product,
        ...listingAvailability(store, product.availability_mode !== "scheduled_harvest" || Date.parse(product.harvest_order_cutoff_at || "") > Date.now()),
        ...(product.remaining_quantity <= 0 ? { can_order_now: false, order_blocker: "AGRIMARKET_ITEM_UNAVAILABLE" } : {}),
      };
      setProducts(current => current.map(update));
      setCart(current => current.map(line => ({ ...line, product: update(line.product) })));
      setQuote(null);
      if (status !== "open") {
        setCartMessage(status === "closed" ? "Closed for now. Your cart is saved, but this store is not accepting new orders." : "This store is temporarily unavailable. Your cart is saved; ordering is paused.");
        return false;
      }
      setCartMessage("Store is accepting orders. Stock and prices are checked again when you request a quote.");
      return true;
    } catch {
      if (request === availabilityRequest.current && scope === cartScope.current) {
        setQuote(null); setCartMessage("Store availability could not be checked. Retry before ordering.");
      }
      return false;
    }
  }

  async function getQuote() {
    if (!addressId || !cart.length || quoting || ordering) return;
    if (cartError) { setCartMessage(cartError); return; }
    setQuoting(true);
    setError("");
    try {
    if (!await refreshCartStore()) return;
    const response = await fetch("/api/agrimarket/quote", {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify({ address_id: addressId, items: cartPayload(), preferred_vehicle_type: preferredVehicle }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok === false) {
      setQuote(null);
      setError(payload?.message || payload?.error || "Unable to calculate this Agrimarket quote.");
    } else {
      setQuote(payload);
    }
    } catch {
      setQuote(null);
      setError("The delivery quote could not be loaded. Check your connection and try again.");
    } finally { setQuoting(false); }
  }

  async function placeOrder() {
    if (!quote || !addressId || !cart.length || ordering || quoting) return;
    setOrdering(true);
    setError("");
    const quoteId = quote?.checkout_quote?.quote_id;
    if (!quoteId) { setOrdering(false); setError("Request and review a fresh price quote before checkout."); return; }
    const requestBody = JSON.stringify({ address_id: addressId, items: cartPayload(), preferred_vehicle_type: preferredVehicle, accepted_quote_id: quoteId });
    const cartIdentity = JSON.stringify({ address_id: addressId, items: cartPayload(), preferred_vehicle_type: preferredVehicle });
    if (checkoutAttempt.current?.body !== cartIdentity) {
      checkoutAttempt.current = { body: cartIdentity, id: crypto.randomUUID() };
    }
    const requestId = checkoutAttempt.current.id;
    try {
    // The atomic checkout rechecks store/stock and accepted terms; retain this token on network uncertainty.
    const response = await fetch("/api/agrimarket/orders", {
      method: "POST",
      headers: { ...authHeaders(true), "x-idempotency-key": requestId },
      body: requestBody,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok === false || !payload?.order?.order_code) {
      setError(payload?.message || "Unable to confirm the order response. Retry to recover this checkout attempt.");
      if (["AGRIMARKET_QUOTE_CHANGED", "AGRIMARKET_QUOTE_EXPIRED"].includes(payload?.error)) { setQuote(null); checkoutAttempt.current = null; }
    } else {
      setPlaced(payload.order);
      setQuote(null);
      setCart([]);
      checkoutAttempt.current = null;
    }
    } catch {
      setError("The order response was interrupted. Retry to recover the same checkout attempt.");
    } finally {
      setOrdering(false);
    }
  }

  if (loading && !session) {
    return (
      <main className="min-h-screen bg-emerald-50 px-4 py-10">
        <div className="mx-auto max-w-xl rounded-3xl bg-white p-8 text-center shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-widest text-emerald-700">JRide Agrimarket</p>
          <p className="mt-3 text-slate-600">Checking your passenger session...</p>
        </div>
      </main>
    );
  }

  if (!loading && session?.error) {
    return (
      <main className="min-h-screen bg-emerald-50 px-4 py-10">
        <div className="mx-auto max-w-xl rounded-3xl bg-white p-8 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-widest text-emerald-700">JRide Agrimarket</p>
          <h1 className="mt-2 text-3xl font-bold">Unable to check your passenger session</h1>
          <p className="mt-3 text-slate-600">{session.message || "Please try again."}</p>
          <button type="button" onClick={() => void initialize()} className="mt-5 rounded-xl bg-emerald-700 px-5 py-3 font-semibold text-white">Retry</button>
        </div>
      </main>
    );
  }

  if (!loading && session && session.authed !== true) {
    return (
      <main className="min-h-screen bg-emerald-50 px-4 py-10">
        <div className="mx-auto max-w-xl rounded-3xl bg-white p-8 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-widest text-emerald-700">JRide Agrimarket</p>
          <h1 className="mt-2 text-3xl font-bold">Sign in to shop Agrimarket</h1>
          <p className="mt-3 text-slate-600">Your passenger account is required to view delivery addresses, add products, and place an order.</p>
          <Link href={passengerLoginHref("/agrimarket")} className="mt-5 inline-flex rounded-xl bg-emerald-700 px-5 py-3 font-semibold text-white">Passenger Sign In</Link>
          <Link href="/passenger" className="ml-2 mt-5 inline-flex rounded-xl border border-emerald-700 px-5 py-3 font-semibold text-emerald-800">Passenger home</Link>
        </div>
      </main>
    );
  }

  if (disabled) {
    return <main className="min-h-screen bg-emerald-50 px-4 py-10"><div className="mx-auto max-w-xl rounded-3xl bg-white p-8 shadow-sm"><h1 className="text-3xl font-bold">Agrimarket is still in pre-launch</h1><p className="mt-3 text-slate-600">The marketplace will appear here when JRide enables it.</p><Link href="/passenger" className="mt-5 inline-flex rounded-xl bg-emerald-700 px-5 py-3 font-semibold text-white">Back to Passenger</Link></div></main>;
  }

  return (
    <main className="min-h-screen bg-slate-50 px-3 py-5 text-slate-900 sm:px-5">
      <div className="mx-auto max-w-7xl">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div><p className="text-sm font-semibold uppercase tracking-widest text-emerald-700">JRide Agrimarket</p><h1 className="text-3xl font-bold">Buy directly from local farmers</h1><p className="mt-1 text-sm text-slate-600">Compare products by town and delivery distance, then open a store to build your order. Farmer contact details and exact pickup locations stay private.</p></div>
          <div className="flex flex-wrap items-center justify-end gap-2"><span className="rounded-xl border bg-white px-3 py-2 text-xs font-semibold">{session?.user?.full_name || session?.user?.name || session?.user?.email || "Signed in"}</span><Link href="/agrimarket/order" className="rounded-xl border bg-white px-4 py-2 text-sm font-semibold">Track order</Link><Link href="/passenger" className="rounded-xl border bg-white px-4 py-2 text-sm font-semibold">Passenger home</Link><button type="button" onClick={async () => { await signOutPassenger(); window.location.replace("/passenger"); }} className="rounded-xl border bg-white px-4 py-2 text-sm font-semibold">Sign out</button></div>
        </header>

        {error ? <div className="mt-4 rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}</div> : null}
        {cartMessage ? <div role="status" className="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">{cartMessage}</div> : null}
        {placed ? <div className="mt-4 rounded-2xl bg-emerald-50 p-5 text-emerald-950"><p className="font-bold">Order placed: {placed.order_code}</p><p className="mt-1 text-sm">{placed.fulfillment_mode === "scheduled_harvest" ? "Waiting for the farmer to confirm your reservation." : "Waiting for farmer confirmation."}</p><Link href={`/agrimarket/order?code=${encodeURIComponent(placed.order_code)}`} className="mt-3 inline-flex rounded-xl bg-emerald-700 px-4 py-2 font-semibold text-white">Track this order</Link></div> : null}

        {crossTownPending ? (
          <section id="agrimarket-cross-town" className="mt-4 rounded-2xl border-2 border-amber-400 bg-amber-50 p-5 text-amber-950">
            <h2 className="text-lg font-bold">Cross-Town Order</h2>
            <p className="mt-2 text-sm">This product is from <strong>{crossTownPending.producer_town}</strong>. Your selected delivery location is in <strong>{deliveryTown || "an unresolved town"}</strong>, {exactRoadDistance(crossTownPending.road_distance_km)} by road from this farmer.</p>
            <p className="mt-2 text-sm">Cross-town delivery may cost more and may take longer than ordering from a nearby farmer. Delivery fare and applicable load/handling charges will be shown before you confirm the order.</p>
            <p className="mt-2 text-xs">Fulfillment is JRide delivery to your selected pin only. Farmer contact details and the exact pickup location remain private.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={continueCrossTown} className="rounded-xl bg-emerald-700 px-4 py-2 font-bold text-white">Continue with this farmer</button>
              <button type="button" onClick={viewCloserOptions} className="rounded-xl border border-amber-700 bg-white px-4 py-2 font-bold text-amber-900">View closer options</button>
            </div>
          </section>
        ) : null}

        <section id="agrimarket-search" className="mt-5 rounded-2xl border bg-white p-4 shadow-sm">
          <label className="text-sm font-semibold">Deliver to<select disabled={quoting || ordering} value={addressId} onChange={(e) => { setAddressId(e.target.value); void loadCatalog(e.target.value); }} className="mt-2 w-full rounded-xl border bg-white px-3 py-3"><option value="">Select delivery address</option>{addresses.filter((row) => row.has_valid_pin).map((address) => <option key={address.id} value={address.id}>{address.label || address.address_text}{address.is_primary ? " (Primary)" : ""}</option>)}</select></label>
          <p className="mt-2 text-xs text-slate-500">Delivery town: <strong>{deliveryTownResolved ? deliveryTown : "Unable to resolve from this pin"}</strong></p>
          <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]"><input value={query} onChange={(e) => { setStoreProductId(null); setQuery(e.target.value); }} className="rounded-xl border px-3 py-3" placeholder="Search products"/><select value={category} onChange={(e) => { setStoreProductId(null); setCategory(e.target.value); }} className="rounded-xl border bg-white px-3 py-3"><option value="all">All categories</option><option value="produce">Produce</option><option value="grain">Rice / Grain</option><option value="aquatic">Aquatic</option><option value="poultry">Poultry</option><option value="livestock">Livestock</option><option value="meat">Meat</option><option value="eggs">Eggs</option><option value="other_agri">Other</option></select></div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-slate-500">{visibleProducts.length} products listed; {visibleProducts.filter(product => product.can_order_now).length} available to order now. Closed stores remain available to browse.</p>
            {!exploreOpen ? <button type="button" onClick={openExplore} className="rounded-xl border border-emerald-700 bg-white px-4 py-2 text-sm font-bold text-emerald-800">Explore other towns</button> : <button type="button" onClick={closeExplore} className="rounded-xl border bg-white px-4 py-2 text-sm font-semibold">Close town comparison</button>}
          </div>

          {exploreOpen ? (
            <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50/40 p-4">
              <div className="grid gap-3 md:grid-cols-2">
                <label className="text-sm font-semibold">Search area<select value={searchArea} onChange={(e) => { setStoreProductId(null); setSearchArea(e.target.value as SearchArea); }} className="mt-1 w-full rounded-xl border bg-white px-3 py-2"><option value="near_me">Near me</option><option value="my_town" disabled={!deliveryTownResolved}>My town</option><option value="nearby_towns" disabled={!deliveryTownResolved}>Nearby towns</option><option value="all_ifugao">All Ifugao</option></select></label>
                <label className="text-sm font-semibold">Sort by<select value={sortMode} onChange={(e) => { setStoreProductId(null); setSortMode(e.target.value as SortMode); }} className="mt-1 w-full rounded-xl border bg-white px-3 py-2"><option value="closest_recommended">Closest / Recommended</option><option value="lowest_price">Lowest price</option><option value="availability">Availability</option><option value="price_distance">Price + distance</option></select></label>
              </div>
              <p className="mt-2 text-xs text-slate-600">Near me keeps the full location-aware catalog ranked from your delivery pin. My town shows same-town farmers only. Nearby towns shows other Ifugao towns without a distance cap. All Ifugao removes the town filter. Price + distance is a comparison ranking only; it does not calculate a final delivered total.</p>
              {!deliveryTownResolved ? <p className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">My town and Nearby towns require a delivery municipality resolved from your map pin.</p> : null}

              <div className="mt-4 overflow-x-auto rounded-xl border bg-white">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-3 py-2">Seller</th><th className="px-3 py-2">Town</th><th className="px-3 py-2">Price</th><th className="px-3 py-2">Distance</th><th className="px-3 py-2">Availability</th><th className="px-3 py-2"></th></tr></thead>
                  <tbody>{visibleProducts.map((product) => <tr key={`compare-${product.id}`} className="border-t align-top"><td className="px-3 py-3"><strong>{product.producer_alias}</strong><div className="text-xs text-slate-500">{product.name}</div>{comparisonHint(product) ? <div className="mt-1 text-xs font-semibold text-emerald-700">{comparisonHint(product)}</div> : null}</td><td className="px-3 py-3">{product.producer_town || "-"}</td><td className="px-3 py-3">{money(product.unit_price)} / {product.selling_unit}</td><td className="px-3 py-3">{exactRoadDistance(product.road_distance_km)}</td><td className="px-3 py-3">{product.can_order_now ? `${product.remaining_quantity} available to order` : isStoreUnavailable(product) ? product.store_status_label : "Reservations closed"}</td><td className="px-3 py-3"><button type="button" onClick={() => openProduct(product)} className="rounded-lg border border-emerald-700 px-3 py-2 text-xs font-bold text-emerald-800">View</button></td></tr>)}</tbody>
                </table>
                {!visibleProducts.length ? <p className="p-4 text-sm text-slate-500">No listings match this search area and filter.</p> : null}
              </div>
            </div>
          ) : null}
        </section>

        <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_380px]">
          <div className="min-w-0">
            {storeProduct ? <StoreProfile key={storeProduct.id} productId={storeProduct.id} products={storeProducts}
              cartProducts={cart.map(line => line.product)} busy={quoting || ordering}
              otherStoreName={cart.length && cart[0].product.cart_group_key !== storeProduct.cart_group_key ? cartStore?.name || "another store" : null}
              onAdd={addStoreItem} onClose={() => setStoreProductId(null)} onReviewCart={reviewCart} /> : null}
            {selectedProduct && !storeProduct ? (
              <section id="agrimarket-product-detail" className="mb-5 rounded-3xl border border-emerald-200 bg-white p-5 shadow-sm">
                <ProductPhoto url={selectedProduct.photo_urls?.[0]} name={selectedProduct.name} className={`mb-4 max-w-lg ${isStoreUnavailable(selectedProduct) ? "grayscale opacity-70" : ""}`} />
                <StoreAvailabilityNotice product={selectedProduct} />
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">{selectedProduct.producer_alias}</p>
                    <h2 className="mt-1 text-2xl font-bold">{selectedProduct.name}</h2>
                    <button type="button" onClick={() => setStoreProductId(selectedProduct.id)} className="mt-2 rounded-lg border border-emerald-700 px-3 py-2 text-sm font-bold text-emerald-800">View store profile</button>
                    <p className="mt-1 text-sm text-slate-500">{selectedProduct.producer_town || "Town unavailable"} - {exactRoadDistance(selectedProduct.road_distance_km)} by road from your selected delivery address.</p>
                  </div>
                  <button type="button" onClick={() => setSelectedProductId(null)} className="rounded-xl border bg-white px-3 py-2 text-sm font-semibold text-slate-700">Close</button>
                </div>

                <p className="mt-4 text-sm text-slate-700">{selectedProduct.description || `${titleCase(selectedProduct.condition)} - ${titleCase(selectedProduct.cargo_class)}`}</p>
                <div className="mt-4 grid gap-3 rounded-2xl bg-slate-50 p-4 sm:grid-cols-3">
                  <div><p className="text-xs uppercase text-slate-500">Price</p><p className="font-bold">{money(selectedProduct.unit_price)} / {selectedProduct.selling_unit}</p></div>
                  <div><p className="text-xs uppercase text-slate-500">Available</p><p className="font-bold">{selectedProduct.remaining_quantity} reservable</p></div>
                  <div><p className="text-xs uppercase text-slate-500">Cargo</p><p className="font-bold">{titleCase(selectedProduct.cargo_class)}</p></div>
                </div>
                {selectedProduct.is_cross_town ? <p className="mt-3 rounded-xl bg-amber-50 p-3 text-xs text-amber-900">Cross-town listing. JRide will deliver to your selected pin; customer pickup or farmer meet-up is not available.</p> : null}
                {selectedProduct.availability_mode === "scheduled_harvest" ? <div className="mt-3 rounded-xl bg-amber-50 p-3 text-xs text-amber-900"><strong>{scheduledTitle([selectedProduct])}</strong><br/>Expected: {formatDate(selectedProduct.harvest_start_at)}{selectedProduct.harvest_end_at ? ` to ${formatDate(selectedProduct.harvest_end_at)}` : ""}<br/>Reserve by: {formatDate(selectedProduct.harvest_order_cutoff_at)}</div> : null}
                {selectedProduct.vehicle_requirement === "tricycle" ? <p className="mt-3 text-xs font-semibold text-blue-800">Tricycle required</p> : null}
                <button type="button" onClick={() => setStoreProductId(selectedProduct.id)} className="mt-4 rounded-xl bg-emerald-700 px-5 py-3 font-bold text-white">Shop this store</button>

                {moreFromSelectedFarmer.length ? (
                  <div className="mt-6 border-t pt-5">
                    <div>
                      <h3 className="text-lg font-bold">More from this farmer</h3>
                      <p className="mt-1 text-sm text-slate-600">Other current listings from this same farmer. Open the store profile to see its name and shop its products. Personal contact details and the exact pickup location stay private.</p>
                    </div>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {moreFromSelectedFarmer.map((product) => (
                        <article key={product.id} className="rounded-2xl border bg-slate-50 p-4">
                          <ProductPhoto url={product.photo_urls?.[0]} name={product.name} className={`mb-3 ${isStoreUnavailable(product) ? "grayscale opacity-70" : ""}`} />
                          <p className="text-xs font-semibold uppercase text-emerald-700">{product.producer_alias}</p>
                          <h4 className="mt-1 font-bold">{product.name}</h4><StoreAvailabilityNotice product={product} compact />
                          <p className="mt-2 text-sm text-slate-600">{money(product.unit_price)} / {product.selling_unit}</p>
                          <p className="mt-1 text-xs text-slate-500">{product.producer_town || "Town unavailable"} - {exactRoadDistance(product.road_distance_km)} - {product.remaining_quantity} listed</p>
                          <button type="button" onClick={() => setStoreProductId(product.id)} className="mt-2 rounded-lg border px-3 py-2 text-sm font-semibold">View store profile</button>
                          <button type="button" onClick={() => openProduct(product)} className="mt-3 w-full rounded-xl border border-emerald-700 bg-white px-3 py-2 text-sm font-bold text-emerald-800">View product</button>
                        </article>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="mt-5 border-t pt-4 text-sm text-slate-500">No other current listings from this farmer.</p>
                )}
              </section>
            ) : null}

            {!storeProduct && <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {loading ? <div className="rounded-2xl border bg-white p-6">Loading Agrimarket...</div> : null}
              {!loading && !visibleProducts.length ? <div className="rounded-2xl border bg-white p-6 text-sm text-slate-600">No products match this search area.</div> : null}
              {!loading && visibleProducts.map((product) => (
                <article key={product.id} className={`rounded-2xl border p-4 shadow-sm ${isStoreUnavailable(product) ? "border-slate-300 bg-slate-50" : "bg-white"}`}>
                  <ProductPhoto url={product.photo_urls?.[0]} name={product.name} className={`mb-4 ${isStoreUnavailable(product) ? "grayscale opacity-70" : ""}`} />
                  <div className="flex items-start justify-between gap-2"><div><div className="flex flex-wrap items-center gap-2"><p className="text-xs font-semibold uppercase text-emerald-700">{product.producer_alias}</p>{isDemoProductName(product.name) ? <span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-amber-800">Demo listing</span> : null}</div><h2 className="mt-1 text-xl font-bold">{product.name}</h2><StoreAvailabilityNotice product={product} /><p className="mt-1 text-xs text-slate-500">{product.producer_town || "Town unavailable"}</p></div><span className="rounded-full bg-slate-100 px-2 py-1 text-xs">{exactRoadDistance(product.road_distance_km)}</span></div>
                  <p className="mt-2 text-sm text-slate-600">{product.description || `${titleCase(product.condition)} - ${titleCase(product.cargo_class)}`}</p>
                  <div className="mt-3 flex items-end justify-between"><div><strong className="text-lg">{money(product.unit_price)}</strong><span className="text-sm text-slate-500"> / {product.selling_unit}</span></div><span className="text-xs text-slate-500">{product.remaining_quantity} listed</span></div>
                  {comparisonHint(product) ? <p className="mt-2 text-xs font-semibold text-emerald-700">{comparisonHint(product)}</p> : null}
                  {product.is_cross_town ? <p className="mt-2 text-xs font-semibold text-amber-800">Cross-town option</p> : null}
                  {product.availability_mode === "scheduled_harvest" ? <div className="mt-3 rounded-xl bg-amber-50 p-3 text-xs text-amber-900"><strong>{scheduledTitle([product])}</strong><br/>Expected: {formatDate(product.harvest_start_at)}{product.harvest_end_at ? ` to ${formatDate(product.harvest_end_at)}` : ""}<br/>Reserve by: {formatDate(product.harvest_order_cutoff_at)}</div> : null}
                  {product.vehicle_requirement === "tricycle" ? <p className="mt-2 text-xs font-semibold text-blue-800">Tricycle required</p> : null}
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => setStoreProductId(product.id)} className="rounded-xl border px-3 py-3 font-semibold">View store profile</button>
                    <button type="button" onClick={() => openProduct(product)} className="rounded-xl border border-emerald-700 bg-white px-3 py-3 font-bold text-emerald-800">View product</button>
                  </div>
                </article>
              ))}
            </section>}
          </div>

          <aside id="agrimarket-cart" className="h-fit rounded-3xl border bg-white p-5 shadow-sm xl:sticky xl:top-4">
            <fieldset disabled={quoting || ordering}>
            <div className="flex items-center justify-between"><h2 className="text-xl font-bold">Cart</h2>{cart.length ? <button onClick={clearCart} className="text-sm font-semibold text-red-700">Clear</button> : null}</div>
            {!cart.length ? <p className="mt-4 text-sm text-slate-500">Open a store to add products. Items from the same store and delivery group share one order and delivery quote.</p> : <>
              <h3 className="mt-3 break-words text-lg font-bold text-emerald-800">{cartStore?.name || "Selected store"}</h3>
              <p className="mt-1 text-sm text-slate-600">{cart[0].product.producer_town} - {cargoGroupLabel(cart[0].product.cargo_class)}</p>
              <button type="button" onClick={() => setStoreProductId(cart[0].product.id)} className="mt-2 rounded-lg border px-3 py-2 text-sm font-semibold">Add more from this store</button>
              <StoreAvailabilityNotice product={cart[0].product} />
              <button type="button" disabled={quoting || ordering} onClick={() => void refreshCartStore()} className="mt-2 rounded-lg border px-3 py-2 text-sm font-semibold">Refresh store availability</button>
              {cartError && <p role="alert" className="mt-3 text-sm text-red-800">{cartError}</p>}
              <p className="mt-2 text-xs text-slate-500">{cartMode === "scheduled_harvest" ? `${scheduledTitle(cart.map(item => item.product))} cart` : "Always Available cart"} - one farmer only</p>
              {cartCrossTownProduct ? <div className="mt-3 rounded-xl bg-amber-50 p-3 text-xs text-amber-900"><strong>Cross-town order</strong><br/>{cartCrossTownProduct.producer_town} to {deliveryTown}: {exactRoadDistance(cartCrossTownProduct.road_distance_km)} by road.<br/>JRide delivery to this selected pin only; no customer pickup or farmer meet-up.</div> : null}
              {cartHarvest ? <div className="mt-3 rounded-xl bg-amber-50 p-3 text-xs text-amber-900">{scheduledTitle(cart.map(item => item.product))}: {formatDate(cartHarvest.harvest_start_at)}{cartHarvest.harvest_end_at ? ` to ${formatDate(cartHarvest.harvest_end_at)}` : ""}</div> : null}
              <div className="mt-4 space-y-3">{cart.map((line) => <div key={line.product.id} className="rounded-xl border p-3"><div className="flex justify-between gap-2"><div><strong>{line.product.name}</strong><p className="text-xs text-slate-500">{money(line.product.unit_price)} / {line.product.selling_unit}</p></div><strong>{money(cartLineAmount(line))}</strong></div><div className="mt-2 flex items-center gap-2"><input aria-label={`Quantity for ${line.product.name}`} type="number" min="0" max={line.product.remaining_quantity} step="0.01" value={line.quantity} onChange={(e) => updateQuantity(line.product.id, Number(e.target.value))} className="w-28 rounded-lg border px-2 py-2"/><span className="text-xs text-slate-500">{line.product.selling_unit}</span></div></div>)}</div>
              <div className="mt-4 flex justify-between border-t pt-3"><span>Products</span><strong>{money(cartSubtotal)}</strong></div>
              <p className="mt-2 text-sm text-slate-600">Combined estimated cargo: {cartWeight == null ? "Farmer confirmation required" : `${cartWeight} kg`}</p>
              <label className="mt-4 block text-sm font-semibold">
                Preferred eligible vehicle
                <select
                  value={preferredVehicle}
                  onChange={(e) => {
                    setPreferredVehicle(e.target.value as AgrimarketVehicle);
                    setQuote(null);
                  }}
                  className="mt-2 w-full rounded-xl border bg-white px-3 py-3"
                >
                  <option value="motorcycle" disabled={vehicleRank(cartRequiredVehicle) > 1}>Motorcycle</option>
                  <option value="tricycle" disabled={vehicleRank(cartRequiredVehicle) > 2}>Tricycle</option>
                  <option value="kolong_kolong">Kolong-Kolong</option>
                </select>
              </label>
              {cartRequiredVehicle === "kolong_kolong" ? (
                <p className="mt-1 text-xs text-blue-800">This cart requires Kolong-Kolong.</p>
              ) : cartRequiredVehicle === "tricycle" ? (
                <p className="mt-1 text-xs text-blue-800">This cart requires a Tricycle or Kolong-Kolong.</p>
              ) : null}
              <button onClick={getQuote} disabled={quoting || ordering || !addressId || Boolean(cartError)} className="mt-4 w-full rounded-xl border-2 border-emerald-700 px-4 py-3 font-bold text-emerald-800 disabled:border-slate-300 disabled:text-slate-400">{quoting ? "Calculating..." : "Review delivery quote"}</button>
            </>}

            {quote ? (
              <div className="mt-5 rounded-2xl bg-slate-50 p-4 text-sm">
                <h3 className="font-bold">Order quote</h3>
                <p className="mt-1 text-xs text-slate-600">Delivery is calculated now. Heavy Load and Special Handling are confirmed by the farmer before dispatch. Driver Approach is finalized only after an actual driver is assigned.</p>
                <div className="mt-3 space-y-2">
                  <div className="flex justify-between"><span>Products</span><strong>{money(quote.product_subtotal)}</strong></div>
                  <div className="flex justify-between"><span>Delivery</span><strong>{money(quote.delivery?.delivery_fee)}</strong></div>
                  {quote.estimated_cargo_weight_kg == null ? (
                    <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">Estimated cargo weight unavailable - farmer will confirm the load before dispatch.</p>
                  ) : (
                    <div className="flex justify-between"><span>Estimated cargo weight</span><strong>{quote.estimated_cargo_weight_kg} kg</strong></div>
                  )}
                  <div className="flex justify-between gap-3"><span>Heavy Load Fee</span><strong className="text-right">{quote.heavy_load_fee?.estimate_exceeds_v1_limit ? "Farmer confirmation required" : quote.heavy_load_fee?.estimated_fee == null ? "Pending farmer confirmation" : `${money(quote.heavy_load_fee.estimated_fee)} estimated`}</strong></div>
                  <div className="flex justify-between gap-3"><span>Special Handling Fee</span><strong className="text-right">Pending farmer confirmation</strong></div>
                  <div className="flex justify-between gap-3"><span>Driver Approach Fee</span><strong className="text-right">Pending driver assignment</strong></div>
                  <div className="flex justify-between border-t pt-2 text-base"><span>Current quoted total</span><strong>{money(quote.initial_approved_total ?? quote.total_before_driver_pickup_surcharge)}</strong></div>
                </div>
                {quote.heavy_load_fee?.estimate_exceeds_v1_limit ? <p className="mt-3 rounded-xl bg-red-50 p-3 text-xs text-red-800">The listing-based weight estimate is above the 200 kg JRide cargo limit. The farmer must confirm the actual load; orders above 200 kg are not supported.</p> : null}
                {Array.isArray(quote.heavy_load_fee?.tiers) ? <p className="mt-3 text-xs text-slate-600">Heavy Load tiers: {quote.heavy_load_fee.tiers.map((tier: any) => `up to ${tier.max_kg} kg = ${money(tier.fee)}`).join(" / ")}. The farmer's exact weight or selected weight band is authoritative.</p> : null}
                {quote.special_handling_fee?.tiers ? <p className="mt-2 text-xs text-slate-600">Special Handling tiers: {Object.entries(quote.special_handling_fee.tiers).map(([tier, fee]) => `${titleCase(tier)} = ${money(fee)}`).join(" / ")}.</p> : null}
                <p className="mt-3 rounded-xl bg-amber-50 p-3 text-xs text-amber-900">If the farmer confirmation increases your total or changes the required vehicle to Tricycle or Kolong-Kolong, JRide pauses the order and asks you to accept the revised charges before dispatch.</p>
                <p className="mt-3 rounded-xl bg-blue-50 p-3 text-xs text-blue-900">Driver Approach Fee: the first {quote.driver_approach_fee?.first_km_free ?? 1.5} km has no raw pickup charge. From 1.5 to 6.5 km, approach pricing increases by {money(quote.driver_approach_fee?.tier_one_fee_per_block ?? 20)} per started 0.5 km; above 6.5 km through 10 km, by {money(quote.driver_approach_fee?.tier_two_fee_per_block ?? 10)} per started 0.5 km. The {money(quote.driver_approach_fee?.base_delivery_fee_credit ?? quote.delivery?.base_fee ?? 40)} delivery base is credited against that approach charge, so it is not charged twice. The normal approach charge is capped at {money(quote.driver_approach_fee?.max_approach_charge ?? 270)} and normal assignment is limited to {quote.driver_approach_fee?.normal_assignment_max_km ?? 10} km.</p>
                {quote.fulfillment?.is_scheduled_harvest ? <p className="mt-3 rounded-xl bg-amber-50 p-3 text-xs text-amber-900">This reserves the expected quantity. No driver is assigned until the farmer confirms the products are ready. Any delay or shortfall needs your approval.</p> : null}
                {quote.cash_collection?.required ? <p className="mt-3 rounded-xl bg-blue-50 p-3 text-xs text-blue-900">Product subtotal is above PHP 500. The assigned driver will collect {money(quote.cash_collection.amount)} product cash from you before going to the farmer.</p> : null}
                <p className="mt-3 text-xs text-slate-600">Price quote valid until {formatDate(quote.checkout_quote?.expires_at)} (Philippine time). This does not change the preparation schedule or the farmer confirmation window.</p>
                <button onClick={placeOrder} disabled={ordering} className="mt-4 w-full rounded-xl bg-emerald-700 px-4 py-3 font-bold text-white">{ordering ? "Placing..." : quote.fulfillment?.is_scheduled_harvest ? "Reserve scheduled order" : "Place order"}</button>
              </div>
            ) : null}
            </fieldset>
          </aside>
        </div>
      </div>
    </main>
  );
}
