"use client";
import { useState } from "react";
import { UI } from "@/lib/i18n";

export type Ev = { sourceQuote: string; document: string; confidence: number };

/** Any claim wrapped in this becomes clickable and reveals quote, source file and confidence. */
export function Claim({ text, ev, t }: { text: string; ev: Ev; t: (typeof UI)["en"] }) {
  const [open, setOpen] = useState(false);
  const pct = Math.round(ev.confidence * 100);
  const color = pct >= 85 ? "bg-emerald-500" : pct >= 60 ? "bg-amber-500" : "bg-rose-500";
  return (
    <span className="relative inline-block">
      <button onClick={() => setOpen(!open)} className="underline decoration-dotted underline-offset-2 hover:bg-slate-100 rounded px-0.5">
        {text}
      </button>
      {open && (
        <span className="absolute z-10 left-0 top-6 w-72 rounded-lg border bg-white p-3 text-xs shadow-lg">
          <span className="block font-semibold text-slate-500">{t.evidence}</span>
          <span className="block italic my-1">“{ev.sourceQuote}”</span>
          <span className="block text-slate-500">{t.source}: {ev.document}</span>
          <span className="mt-2 flex items-center gap-2">
            <span className="h-1.5 flex-1 rounded bg-slate-200"><span className={`block h-1.5 rounded ${color}`} style={{ width: `${pct}%` }} /></span>
            <span>{t.confidence} {pct}%</span>
          </span>
        </span>
      )}
    </span>
  );
}
