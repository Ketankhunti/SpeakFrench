"use client";

import { useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  Mic,
  ArrowLeft,
  ChevronRight,
  GraduationCap,
  BookOpen,
  MessageSquare,
  Users,
  Sparkles,
  Shield,
  Globe,
  AlertCircle,
  CreditCard,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { fetchBalance, fetchDemoStatus } from "@/lib/api";
import SessionView from "@/components/session/SessionView";

const TCF_PARTS = [
  {
    part: 1,
    title: "Tâche 1 — Entretien dirigé",
    description: "Answer personal questions about yourself: name, profession, hobbies, daily life.",
    duration: "2 min",
    icon: Users,
    color: "from-blue-500 to-cyan-400",
  },
  {
    part: 2,
    title: "Tâche 2 — Interaction",
    description: "Role-play a real-life situation: booking, buying, complaining, asking for directions.",
    duration: "5 min 30",
    icon: MessageSquare,
    color: "from-emerald-500 to-teal-400",
  },
  {
    part: 3,
    title: "Tâche 3 — Point de vue",
    description: "Present and defend your opinion on a social topic with structured arguments.",
    duration: "4 min 30",
    icon: BookOpen,
    color: "from-violet-500 to-purple-400",
  },
];

const TEF_PARTS = [
  {
    part: 1,
    title: "Section A — Renseignements & Position",
    description: "Obtain information and give your opinion on a given situation (housing, offers, services).",
    duration: "5 min",
    icon: Globe,
    color: "from-amber-500 to-orange-400",
  },
  {
    part: 2,
    title: "Section B — Argumentation",
    description: "Present arguments for and against a controversial topic. Defend your position.",
    duration: "10 min",
    icon: Shield,
    color: "from-rose-500 to-pink-400",
  },
];

const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];

function SessionContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user } = useAuth();
  const isDemo = searchParams.get("demo") === "true";

  const [step, setStep] = useState<"exam" | "level" | "part" | "session">("exam");
  const [examType, setExamType] = useState<"tcf" | "tef">("tcf");
  const [level, setLevel] = useState("B1");
  const [examPart, setExamPart] = useState(1);
  const [accessError, setAccessError] = useState<"credits" | "demo" | null>(null);
  const [checkingBalance, setCheckingBalance] = useState(false);

  const userId = user?.id || "demo-user";
  const parts = examType === "tcf" ? TCF_PARTS : TEF_PARTS;

  const startSession = async (part: number) => {
    setAccessError(null);

    if (isDemo) {
      setCheckingBalance(true);
      try {
        const demo = await fetchDemoStatus(userId);
        if (demo.demo_used) {
          setAccessError("demo");
          setCheckingBalance(false);
          return;
        }
      } catch {
        // If demo status check fails, backend WS guard will handle it
      }
      setCheckingBalance(false);
      setExamPart(part);
      setStep("session");
      return;
    }

    setCheckingBalance(true);
    try {
      const data = await fetchBalance(userId);
      if ((data.sessions_remaining ?? 0) <= 0) {
        setAccessError("credits");
        setCheckingBalance(false);
        return;
      }
    } catch {
      // If balance check fails, let the WS handle it
    }
    setCheckingBalance(false);
    setExamPart(part);
    setStep("session");
  };

  const handleSessionEnd = () => {
    router.push("/dashboard");
  };

  if (step === "session") {
    return (
      <div className="min-h-screen bg-[var(--background)] relative noise-overlay p-4">
        <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
          <div className="absolute top-[-15%] left-[-5%] w-[45%] h-[45%] rounded-full bg-indigo-600/12 blur-[140px]" />
          <div className="absolute bottom-[-15%] right-[-5%] w-[35%] h-[35%] rounded-full bg-violet-600/8 blur-[120px]" />
        </div>
        <div className="relative z-10">
          <SessionView
            userId={userId}
            examType={examType}
            examPart={examPart}
            level={level}
            isDemo={isDemo}
            onSessionEnd={handleSessionEnd}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--background)] relative noise-overlay">
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <div className="absolute top-[-15%] left-[-5%] w-[45%] h-[45%] rounded-full bg-indigo-600/12 blur-[140px]" />
        <div className="absolute bottom-[-15%] right-[-5%] w-[35%] h-[35%] rounded-full bg-violet-600/8 blur-[120px]" />
      </div>

      <div className="relative z-10 mx-auto max-w-3xl px-6 py-16">
        {/* Back button */}
        <button
          onClick={() => {
            if (step === "exam") router.push("/dashboard");
            else if (step === "level") setStep("exam");
            else if (step === "part") setStep("level");
          }}
          className="flex items-center gap-2 text-sm text-slate-400 hover:text-white transition-colors mb-8"
        >
          <ArrowLeft size={16} />
          {step === "exam" ? "Dashboard" : "Back"}
        </button>

        {/* Progress indicator */}
        <div className="flex items-center gap-2 mb-10">
          {["exam", "level", "part"].map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                  step === s
                    ? "bg-gradient-to-r from-indigo-500 to-violet-500 text-white shadow-lg shadow-indigo-500/25"
                    : ["exam", "level", "part"].indexOf(step) > i
                      ? "bg-indigo-500/20 text-indigo-300 border border-indigo-400/30"
                      : "bg-white/[0.06] text-slate-500 border border-white/10"
                }`}
              >
                {i + 1}
              </div>
              {i < 2 && (
                <div className={`w-12 h-px ${["exam", "level", "part"].indexOf(step) > i ? "bg-indigo-400/40" : "bg-white/10"}`} />
              )}
            </div>
          ))}
        </div>

        <AnimatePresence mode="wait">
          {/* Step 1: Choose Exam Type */}
          {step === "exam" && (
            <motion.div
              key="exam"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
            >
              <div className="mb-8">
                <h1 className="text-3xl font-bold text-white mb-2">Choose Your Exam</h1>
                <p className="text-slate-400">Select the French proficiency exam you&apos;re preparing for.</p>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                {[
                  {
                    type: "tcf" as const,
                    label: "TCF",
                    full: "Test de Connaissance du Français",
                    description: "3-part oral exam: personal interview, role-play interaction, and opinion expression.",
                    parts: "3 parts",
                    gradient: "from-indigo-500 to-violet-500",
                  },
                  {
                    type: "tef" as const,
                    label: "TEF Canada",
                    full: "Test d'Évaluation de Français",
                    description: "2-section oral exam: information gathering with position, and structured argumentation.",
                    parts: "2 sections",
                    gradient: "from-amber-500 to-orange-500",
                  },
                ].map((exam) => (
                  <button
                    key={exam.type}
                    onClick={() => {
                      setExamType(exam.type);
                      setStep("level");
                    }}
                    className="glass-card p-6 text-left group hover:border-indigo-400/30 transition-all"
                  >
                    <div className={`inline-flex rounded-xl bg-gradient-to-br ${exam.gradient} p-3 text-white mb-4 shadow-lg transition-transform group-hover:scale-110`}>
                      <GraduationCap size={24} />
                    </div>
                    <h3 className="text-xl font-bold text-white mb-1">{exam.label}</h3>
                    <p className="text-xs text-indigo-300 mb-3">{exam.full}</p>
                    <p className="text-sm text-slate-400 mb-4">{exam.description}</p>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-500">{exam.parts}</span>
                      <ChevronRight size={16} className="text-slate-500 group-hover:text-indigo-400 transition-colors" />
                    </div>
                  </button>
                ))}
              </div>
            </motion.div>
          )}

          {/* Step 2: Choose Level */}
          {step === "level" && (
            <motion.div
              key="level"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
            >
              <div className="mb-8">
                <h1 className="text-3xl font-bold text-white mb-2">Select Your Level</h1>
                <p className="text-slate-400">
                  Choose the CEFR level you want to practice at for the{" "}
                  <span className="text-indigo-300 font-medium">{examType.toUpperCase()}</span> exam.
                </p>
              </div>

              <div className="grid gap-3 grid-cols-2 md:grid-cols-3">
                {LEVELS.map((l) => {
                  const descriptions: Record<string, string> = {
                    A1: "Beginner — basic phrases and expressions",
                    A2: "Elementary — everyday situations",
                    B1: "Intermediate — familiar topics",
                    B2: "Upper Intermediate — complex texts",
                    C1: "Advanced — implicit meaning",
                    C2: "Mastery — near-native fluency",
                  };
                  return (
                    <button
                      key={l}
                      onClick={() => {
                        setLevel(l);
                        setStep("part");
                      }}
                      className={`glass-card p-5 text-left group hover:border-indigo-400/30 transition-all ${
                        level === l ? "border-indigo-400/30 bg-indigo-500/5" : ""
                      }`}
                    >
                      <span className="text-2xl font-bold text-white">{l}</span>
                      <p className="text-xs text-slate-400 mt-2">{descriptions[l]}</p>
                    </button>
                  );
                })}
              </div>
            </motion.div>
          )}

          {/* Step 3: Choose Part */}
          {step === "part" && (
            <motion.div
              key="part"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
            >
              <div className="mb-8">
                <h1 className="text-3xl font-bold text-white mb-2">Exam Overview</h1>
                <p className="text-slate-400">
                  <span className="text-indigo-300 font-medium">{examType.toUpperCase()}</span>
                  {" · "}
                  <span className="text-emerald-300 font-medium">Level {level}</span>
                  {" — "}The examiner will guide you through all parts.
                </p>
              </div>

              <div className="space-y-4">
                {parts.map((p) => (
                  <div
                    key={p.part}
                    className="w-full glass-card p-6 flex items-center gap-5"
                  >
                    <div className={`rounded-2xl bg-gradient-to-br ${p.color} p-4 text-white shadow-lg shrink-0`}>
                      <p.icon size={24} />
                    </div>
                    <div className="flex-1">
                      <h3 className="text-lg font-semibold text-white mb-1">{p.title}</h3>
                      <p className="text-sm text-slate-400">{p.description}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-xs text-slate-500">{p.duration}</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Start exam */}
              <div className="mt-8 text-center">
                {accessError && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="inline-flex items-center gap-3 bg-rose-500/10 border border-rose-400/20 rounded-xl px-5 py-3 mb-5"
                  >
                    <AlertCircle size={18} className="text-rose-400 shrink-0" />
                    <div className="text-left">
                      {accessError === "credits" ? (
                        <>
                          <p className="text-sm font-medium text-rose-300">No session credits remaining</p>
                          <p className="text-xs text-slate-400 mt-0.5">
                            Purchase a session pack to continue practicing.
                          </p>
                        </>
                      ) : (
                        <>
                          <p className="text-sm font-medium text-rose-300">Demo already consumed</p>
                          <p className="text-xs text-slate-400 mt-0.5">
                            Your free demo has been used. Purchase a pack to continue.
                          </p>
                        </>
                      )}
                    </div>
                    <Link
                      href="/pricing"
                      className="ml-2 shrink-0 inline-flex items-center gap-1.5 bg-gradient-to-r from-indigo-500 to-violet-500 text-white text-xs font-semibold px-4 py-2 rounded-lg hover:shadow-lg hover:shadow-indigo-500/25 transition-all"
                    >
                      <CreditCard size={12} />
                      Buy Sessions
                    </Link>
                  </motion.div>
                )}
                <div>
                  <button
                    onClick={() => startSession(1)}
                    disabled={checkingBalance}
                    className="btn-primary px-8 py-3 font-semibold text-white inline-flex items-center gap-2 disabled:opacity-50"
                  >
                    {checkingBalance ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Checking...
                      </>
                    ) : (
                      <>
                        <Sparkles size={16} />
                        Start Exam
                      </>
                    )}
                  </button>
                </div>
                <p className="text-xs text-slate-500 mt-2">The examiner will guide you through all parts sequentially.</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
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
