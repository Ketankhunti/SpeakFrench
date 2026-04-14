"use client";

import { useState, useEffect } from "react";
import { Check, Sparkles } from "lucide-react";
import { motion } from "framer-motion";
import { fetchPacks, createCheckout } from "@/lib/api";

interface Pack {
  id: string;
  name: string;
  sessions: number;
  price_cad: number;
  per_session_cad: number;
}

const FALLBACK_PACKS: Pack[] = [
  { id: "essai_plus", name: "Starter", sessions: 2, price_cad: 3.99, per_session_cad: 2.00 },
  { id: "decouverte", name: "Focus", sessions: 5, price_cad: 9.99, per_session_cad: 2.00 },
  { id: "preparation", name: "Prep", sessions: 20, price_cad: 24.99, per_session_cad: 1.25 },
  { id: "intensif", name: "Intensive", sessions: 50, price_cad: 49.99, per_session_cad: 1.00 },
  { id: "marathon", name: "Marathon", sessions: 100, price_cad: 79.99, per_session_cad: 0.80 },
];

const cardVariants = {
  initial: { opacity: 0, y: 30 },
  animate: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, delay: i * 0.1, ease: [0.16, 1, 0.3, 1] as const },
  }),
};

export default function PricingCards({ userId, compact }: { userId?: string; compact?: boolean }) {
  const [packs, setPacks] = useState<Pack[] | null>(null);
  const [packsLoading, setPacksLoading] = useState(true);
  const [loading, setLoading] = useState<string | null>(null);

  useEffect(() => {
    fetchPacks()
      .then((data) => {
        const values = Object.values(data) as Pack[];
        if (values.length > 0) {
          setPacks(values.sort((a, b) => a.price_cad - b.price_cad));
        } else {
          setPacks(FALLBACK_PACKS);
        }
      })
      .catch(() => {
        // API unavailable — use fallback packs
        setPacks(FALLBACK_PACKS);
      })
      .finally(() => {
        setPacksLoading(false);
      });
  }, []);

  const handlePurchase = async (packId: string) => {
    if (!userId) return;
    setLoading(packId);
    try {
      const { checkout_url } = await createCheckout(
        packId,
        userId,
        `${window.location.origin}/pricing?success=true`,
        `${window.location.origin}/pricing?canceled=true`
      );
      window.location.href = checkout_url;
    } catch {
      setLoading(null);
    }
  };

  const highlighted = "preparation";
  const safePacks = packs ?? [];
  const displayPacks = compact ? safePacks.slice(0, 3) : safePacks;
  const gridCols = compact
    ? "md:grid-cols-3"
    : "md:grid-cols-2 lg:grid-cols-5";

  if (packsLoading) {
    return (
      <div className={`mx-auto grid max-w-7xl grid-cols-1 gap-5 ${gridCols}`}>
        {Array.from({ length: compact ? 3 : 5 }).map((_, i) => (
          <div key={i} className="glass-card p-6 animate-pulse">
            <div className="h-6 w-24 rounded bg-white/10" />
            <div className="mt-3 h-10 w-36 rounded bg-white/10" />
            <div className="mt-2 h-5 w-28 rounded bg-white/10" />
            <div className="mt-6 space-y-3">
              <div className="h-4 w-full rounded bg-white/10" />
              <div className="h-4 w-11/12 rounded bg-white/10" />
              <div className="h-4 w-10/12 rounded bg-white/10" />
              <div className="h-4 w-8/12 rounded bg-white/10" />
            </div>
            <div className="mt-6 h-11 w-full rounded-xl bg-white/10" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={`mx-auto grid max-w-7xl grid-cols-1 gap-5 ${gridCols}`}>
      {displayPacks.map((pack, i) => (
        <motion.div
          key={pack.id}
          custom={i}
          variants={cardVariants}
          initial="initial"
          whileInView="animate"
          viewport={{ once: true }}
          whileHover={{ y: -8, transition: { duration: 0.3 } }}
          className={`relative flex flex-col glass-card p-6 ${
            pack.id === highlighted
              ? "border-indigo-400/30 ring-2 ring-indigo-500/20 shadow-lg shadow-indigo-500/10"
              : ""
          }`}
        >
          {pack.id === highlighted && (
            <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 px-3 py-1 text-xs font-semibold text-white flex items-center gap-1 shadow-lg shadow-indigo-500/25">
              <Sparkles size={12} />
              Most chosen
            </span>
          )}

          <h3 className="text-lg font-semibold text-white">{pack.name}</h3>
          <p className="mt-2 text-3xl font-bold text-white">
            ${pack.price_cad.toFixed(2)}
            <span className="text-sm font-normal text-slate-400"> CAD</span>
          </p>
          <p className="mt-1 text-sm text-slate-400">
            ${pack.per_session_cad.toFixed(2)} / session
          </p>

          <ul className="mt-4 space-y-2.5 flex-1">
            {[
              `${pack.sessions} full speaking sessions`,
              "TCF/TEF parts 1, 2, and 3",
              "Pronunciation and fluency scoring",
              "No expiry date",
            ].map((feature, fi) => (
              <li key={fi} className="flex items-center gap-2 text-sm text-slate-300">
                <div className="rounded-full bg-emerald-500/15 p-0.5">
                  <Check size={14} className="text-emerald-400" />
                </div>
                {feature}
              </li>
            ))}
          </ul>

          <button
            onClick={() => handlePurchase(pack.id)}
            disabled={!userId || loading === pack.id}
            className={`mt-6 w-full rounded-xl py-2.5 font-semibold transition-all duration-300 ${
              pack.id === highlighted
                ? "btn-primary"
                : "bg-white/[0.06] border border-white/10 text-white hover:bg-white/[0.12] hover:border-white/20"
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {loading === pack.id ? "Loading..." : "Buy Pack"}
          </button>
        </motion.div>
      ))}
    </div>
  );
}
