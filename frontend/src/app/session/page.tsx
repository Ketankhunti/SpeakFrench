"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import SessionView from "@/components/session/SessionView";

function SessionContent() {
  const searchParams = useSearchParams();
  const isDemo = searchParams.get("demo") === "true";

  // TODO: Replace with actual user ID from Supabase auth
  const userId = "demo-user";

  return (
    <div className="min-h-screen bg-[var(--background)] relative noise-overlay p-4">
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <div className="absolute top-[-15%] left-[-5%] w-[45%] h-[45%] rounded-full bg-indigo-600/12 blur-[140px]" />
        <div className="absolute bottom-[-15%] right-[-5%] w-[35%] h-[35%] rounded-full bg-violet-600/8 blur-[120px]" />
      </div>
      <div className="relative z-10">
        <SessionView
          userId={userId}
          examPart={1}
          level="B1"
          isDemo={isDemo}
          onSessionEnd={() => {}}
        />
      </div>
    </div>
  );
}

export default function SessionPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-slate-400">Loading...</div>}>
      <SessionContent />
    </Suspense>
  );
}
