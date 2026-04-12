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
  { id: "starter", name: "Starter", sessions: 3, price_cad: 9.99, per_session_cad: 3.33 },
  { id: "basic", name: "Basic", sessions: 10, price_cad: 24.99, per_session_cad: 2.50 },
  { id: "preparation", name: "Preparation", sessions: 25, price_cad: 49.99, per_session_cad: 2.00 },
  { id: "intensive", name: "Intensive", sessions: 50, price_cad: 79.99, per_session_cad: 1.60 },
  { id: "unlimited", name: "Pro", sessions: 100, price_cad: 129.99, per_session_cad: 1.30 },
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
  const [packs, setPacks] = useState<Pack[]>(FALLBACK_PACKS);
  const [loading, setLoading] = useState<string | null>(null);

  useEffect(() => {
    fetchPacks()
      .then((data) => {
        const values = Object.values(data) as Pack[];
        if (values.length > 0) {
          setPacks(values.sort((a, b) => a.price_cad - b.price_cad));
        }
      })
      .catch(() => {
        // API unavailable — keep fallback packs
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
  const displayPacks = compact ? packs.slice(0, 3) : packs;
  const gridCols = compact
    ? "md:grid-cols-3"
    : "md:grid-cols-2 lg:grid-cols-5";

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
