"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft, ArrowUpRight, Check, ClipboardList, Leaf, LockKeyhole, Package, RefreshCw, Sprout } from "lucide-react";
import styles from "./farmer.module.css";

export function FarmerWorkspace({ section, children, onRefresh, loading = false, guest = false }: {
  section: "orders" | "products";
  children: ReactNode;
  onRefresh?: () => void;
  loading?: boolean;
  guest?: boolean;
}) {
  return (
    <div className={styles.workspace}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link href="/agrimarket/producer" className={styles.brand} aria-label="AgriMarket farmer home">
            <span className={styles.brandMark}><Sprout size={25} strokeWidth={1.7} /></span>
            <span>AgriMarket<small>YOUR FARMER SPACE</small></span>
          </Link>
          <Link href="/passenger" className={styles.homeLink}><ArrowLeft size={15} /> Home</Link>
        </div>
      </header>
      <main className={styles.main}>
        {!guest && <nav className={styles.navigation} aria-label="Farmer workspace">
          <div className={styles.tabs}>
            <Link href="/agrimarket/producer" className={`${styles.tab} ${section === "orders" ? styles.selectedTab : ""}`} aria-current={section === "orders" ? "page" : undefined}><ClipboardList size={18} /> Orders</Link>
            <Link href="/agrimarket/producer/products" className={`${styles.tab} ${section === "products" ? styles.selectedTab : ""}`} aria-current={section === "products" ? "page" : undefined}><Package size={18} /> Products</Link>
          </div>
          <button type="button" onClick={onRefresh} disabled={loading} className={styles.refresh} aria-label={loading ? "Refreshing" : `Refresh ${section}`}><RefreshCw size={18} className={loading ? styles.spinning : ""} /></button>
        </nav>}
        {children}
        <footer className={styles.footer}><Sprout size={15} /> Grown locally. Connected by JRide.</footer>
      </main>
    </div>
  );
}

export function FarmerLogin({ section, accessCode, pin, onCodeChange, onPinChange, onSubmit, loading, error }: {
  section: "orders" | "products";
  accessCode: string;
  pin: string;
  onCodeChange: (value: string) => void;
  onPinChange: (value: string) => void;
  onSubmit: () => void;
  loading: boolean;
  error: string;
}) {
  return (
    <FarmerWorkspace section={section} guest>
      <div className={styles.loginIntro}><span className={styles.eyebrow}>FROM YOUR FARM, TO YOUR COMMUNITY</span><h1>A little closer<br />to your customers.</h1><p>Your products, orders and next harvest.<br />All in one place.</p></div>
      <section className={styles.loginCard}>
        <span className={styles.loginIcon}><Leaf size={24} /></span>
        <h2>Welcome, farmer.</h2><p>Sign in with the access code and PIN provided by JRide.</p>
        <form onSubmit={(event) => { event.preventDefault(); onSubmit(); }} className={styles.loginForm}>
          <label>Farmer access code<input autoComplete="username" autoCapitalize="characters" spellCheck={false} required placeholder="AGF-XXXXXXXX" value={accessCode} onChange={(event) => onCodeChange(event.target.value.toUpperCase())} /></label>
          <label>6-digit PIN<input autoComplete="current-password" type="password" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required placeholder="Enter your PIN" value={pin} onChange={(event) => onPinChange(event.target.value.replace(/\D/g, "").slice(0, 6))} /></label>
          <FarmerFeedback error={error} />
          <button disabled={loading || !accessCode.trim() || pin.length !== 6} className={styles.primaryButton}>{loading ? "Checking your details…" : "Open my farm"}<ArrowUpRight size={18} /></button>
        </form>
        <div className={styles.secureNote}><LockKeyhole size={14} /> Your farmer access stays private.</div>
      </section>
      <div className={styles.loginBenefit}><Check size={17} /><span>Free listing. <strong>100% of your product subtotal</strong> during the free launch period.</span></div>
    </FarmerWorkspace>
  );
}

export function FarmerFeedback({ error, message }: { error?: string; message?: string }) {
  return <>{error && <div className={styles.error} role="alert">{error}</div>}{message && <div className={styles.success} role="status"><Check size={17} />{message}</div>}</>;
}

export function FarmerUnavailable({ section }: { section: "orders" | "products" }) {
  return <FarmerWorkspace section={section} guest><section className={styles.emptyCard}><span className={styles.emptyIcon}><Sprout size={38} /></span><h1>We’re getting things ready.</h1><p>The farmer workspace is not open yet. Please check back soon.</p><Link href="/passenger" className={styles.primaryButton}>Back to JRide <ArrowUpRight size={18} /></Link></section></FarmerWorkspace>;
}
