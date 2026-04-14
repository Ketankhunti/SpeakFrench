"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { fetchDemoStatus } from "@/lib/api";
import PricingCards from "@/components/PricingCards";

function PricingContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth(false);
  const success = searchParams.get("success");
  const canceled = searchParams.get("canceled");
  const [demoUsed, setDemoUsed] = useState(false);
  const [demoMessage, setDemoMessage] = useState<string | null>(null);

  const userId = user?.id;

  useEffect(() => {
    if (!user?.id) {
      setDemoUsed(false);
      return;
    }
    fetchDemoStatus(user.id)
      .then((res) => {
        setDemoUsed(Boolean(res.demo_used));
      })
      .catch(() => {
        setDemoUsed(false);
      });
  }, [user?.id]);

  const handleStartDemo = () => {
    if (demoUsed) {
      setDemoMessage("Demo already consumed. Please purchase a session pack to continue.");
      return;
    }
    setDemoMessage(null);
    router.push("/session?demo=true");
  };

  return (
    <div className="min-h-screen bg-[var(--background)] relative noise-overlay">
      {/* Background Orbs */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <div className="absolute top-[-15%] left-[-5%] w-[50%] h-[50%] rounded-full bg-indigo-600/15 blur-[150px]" />
        <div className="absolute bottom-[-15%] right-[-5%] w-[40%] h-[40%] rounded-full bg-violet-600/10 blur-[120px]" />
      </div>

      <div className="relative z-10 mx-auto max-w-6xl px-6 py-12">
        <div className="flex items-center justify-between">
          <Link href="/" className="text-sm text-indigo-400 hover:text-indigo-300 transition-colors">
            &larr; Back to home
          </Link>
          <div className="flex items-center gap-4">
            <Link href="/dashboard" className="text-sm text-indigo-400 hover:text-indigo-300 transition-colors">
              Dashboard
            </Link>
            <Link href="/profile" className="text-sm text-indigo-400 hover:text-indigo-300 transition-colors">
              Profile
            </Link>
          </div>
        </div>

        <h1 className="font-display mt-8 text-center text-4xl text-white md:text-5xl">
          Pick your speaking pack
        </h1>
        <div className="text-center mt-3">
          <span className="inline-flex items-center gap-2 rounded-full border border-indigo-400/20 bg-indigo-500/10 px-4 py-1.5 text-sm font-medium text-indigo-300">
            TCF/TEF-style prompts and formal French scoring focus
          </span>
        </div>
        <p className="mx-auto mb-12 mt-3 max-w-2xl text-center text-slate-400">
          No subscriptions. Buy session credits once and use them anytime.
          All prices are in CAD.
        </p>

        {success && (
          <div className="mb-8 rounded-xl bg-emerald-500/10 border border-emerald-400/20 p-4 text-center text-emerald-300">
            Payment completed. Your sessions were added to your account.
          </div>
        )}

        {canceled && (
          <div className="mb-8 rounded-xl bg-amber-500/10 border border-amber-400/20 p-4 text-center text-amber-300">
            Checkout canceled. You can try again any time.
          </div>
        )}

        <PricingCards userId={userId} />

        <div className="mt-16 border-t border-white/[0.06] pt-12 text-center">
          <h2 className="font-display mb-2 text-3xl text-white">Not sure yet?</h2>
          <p className="mb-4 text-slate-400">
            Start with a free 3-4 minute demo (Part 1 only).
          </p>
          {demoMessage && (
            <div className="mb-4 rounded-xl border border-rose-400/20 bg-rose-500/10 p-3 text-sm text-rose-300">
              {demoMessage}
            </div>
          )}
          <button
            onClick={handleStartDemo}
            className={`inline-flex items-center gap-2 px-6 py-3 ${demoUsed ? "opacity-70" : ""} btn-secondary`}
          >
            {demoUsed ? "Demo Used" : "Start Free Demo"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PricingPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-slate-400">Loading...</div>}>
      <PricingContent />
    </Suspense>
  );
}
