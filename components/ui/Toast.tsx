"use client";
import React, { createContext, useContext, useMemo, useState } from "react";
import { createPortal } from "react-dom";
type Toast = { id: number; title?: string; message: string; type?: "success"|"error"|"info" };
type Ctx = { toast: (t: Omit<Toast,"id">) => void; };
const ToastCtx = createContext<Ctx|null>(null);
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const toast = (t: Omit<Toast,"id">) => { const id = Date.now()+Math.random(); setItems(s=>[...s,{id,...t}]); setTimeout(()=>setItems(s=>s.filter(x=>x.id!==id)),3000); };
  const ctx = useMemo(()=>({ toast }),[]);
  return (
    <ToastCtx.Provider value={ctx}>
      {children}
      {createPortal(
        <div className="fixed top-4 right-4 z-[9999] space-y-2">
          {items.map((t)=>(
            <div key={t.id} className="min-w-[240px] max-w-[360px] rounded-xl shadow px-3 py-2 text-sm text-white"
              style={{ background: t.type==="success"?"#16a34a":t.type==="error"?"#dc2626":"#111827" }}>
              {t.title && <div className="font-semibold">{t.title}</div>}
              <div>{t.message}</div>
            </div>
          ))}
        </div>, document.body
      )}
    </ToastCtx.Provider>
  );
}
export function useToast(){ const v = useContext(ToastCtx); if(!v) throw new Error("useToast must be used within ToastProvider"); return v.toast; }
