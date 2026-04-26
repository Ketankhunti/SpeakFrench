"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Mic,
  Play,
  Target,
  TrendingUp,
  Trophy,
  Calendar,
  Clock3,
  BarChart3,
  User,
  CreditCard,
  ArrowRight,
  Sparkles,
  BookOpen,
  ChevronRight,
  FileText,
  MessageSquare,
  X,
  AlertTriangle,
  Crosshair,
  Gauge,
  CalendarDays,
  Shield,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  Legend,
  BarChart,
  Bar,
} from "recharts";
import { useAuth } from "@/hooks/useAuth";
import { fetchDashboard, fetchDemoStatus, regenerateReview, checkAdmin } from "@/lib/api";
import ReviewMarkdown from "@/components/ui/ReviewMarkdown";

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 24 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.5, delay, ease: [0.16, 1, 0.3, 1] as const } },
});

interface SessionData {
  id: string;
  examType: string;
  isDemo: boolean;
  date: string;
  fullDate: string;
  level: string;
  partsCompleted: number[];
  overallScore: number;
  scores: {
    pronunciation: number | null;
    grammar: number;
    vocabulary: number;
    coherence: number;
  };
  corrections: { text?: string; feedback?: string }[];
  review: string;
  transcript: { speaker: string; text: string; part?: number }[];
}

export default function DashboardPage() {
  const { user, loading: authLoading } = useAuth();
  const [dataLoading, setDataLoading] = useState(true);
  const [sessions, setSessions] = useState<SessionData[]>([]);
  const [sessionsRemaining, setSessionsRemaining] = useState(0);
  const [practiceDateSet, setPracticeDateSet] = useState<Set<string>>(new Set());
  const [demoUsed, setDemoUsed] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [examFilter, setExamFilter] = useState<"tcf" | "tef">("tcf");
  const [dateFilter, setDateFilter] = useState<string | null>(null);

  useEffect(() => {
    if (user?.email) {
      checkAdmin(user.email).then((r) => setIsAdmin(r.is_admin)).catch(() => {});
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;

    const loadData = async () => {
      setDataLoading(true);

      try {
        const [data, demo] = await Promise.all([
          fetchDashboard(user.id),
          fetchDemoStatus(user.id).catch(() => ({ demo_used: false })),
        ]);
        setDemoUsed(Boolean(demo.demo_used));

        const toNumberOrNull = (value: unknown): number | null => {
          if (value === null || value === undefined || value === "") return null;
          const n = Number(value);
          return Number.isFinite(n) ? n : null;
        };

        // Map backend sessions to frontend SessionData
        const sessionHistory: SessionData[] = (data.sessions ?? []).map((row: Record<string, unknown>) => {
          const p = toNumberOrNull(row.pronunciation_score);
          const g = Number(row.grammar_score) || 0;
          const v = Number(row.vocabulary_score) || 0;
          const c = Number(row.coherence_score) || 0;
          const overallFromApi = toNumberOrNull(row.overall_score);
          const overallValues = [p, g, v, c].filter((n): n is number => n !== null);
          const overall = overallFromApi ?? (overallValues.length ? Math.round(overallValues.reduce((a, b) => a + b, 0) / overallValues.length) : 0);
          const dt = new Date(row.created_at as string);
          const transcript = Array.isArray(row.transcript)
            ? (row.transcript as { role?: string; content?: string; speaker?: string; text?: string; part?: number }[]).map((t) => ({
                speaker: t.role === "assistant" ? "examiner" : t.speaker || "user",
                text: t.content || t.text || "",
                part: typeof t.part === "number" ? t.part : undefined,
              }))
            : [];
          // Derive parts completed from per-entry part tags (new sessions).
          // Older rows have no per-entry tags — we only know the last reached
          // part, so just show that single part rather than fabricating a range.
          const partsFromTranscript = Array.from(
            new Set(transcript.map((t) => t.part).filter((p): p is number => typeof p === "number"))
          ).sort((a, b) => a - b);
          const highestPart = Number(row.exam_part) || 1;
          const partsCompleted = partsFromTranscript.length
            ? partsFromTranscript
            : [highestPart];
          return {
            id: row.id as string,
            examType: (row.exam_type as string) || "tcf",
            isDemo: Boolean(row.is_demo),
            date: dt.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
            fullDate: dt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
            level: (row.level as string) || "B1",
            partsCompleted,
            overallScore: overall,
            scores: { pronunciation: p, grammar: g, vocabulary: v, coherence: c },
            corrections: Array.isArray(row.corrections) ? (row.corrections as { text?: string; feedback?: string }[]) : [],
            review: (row.ai_review as string) || "No AI review available for this session.",
            transcript,
          };
        });

        setSessions(sessionHistory);
        setPracticeDateSet(new Set(data.practice_dates ?? []));

        const s = data.stats ?? {};
        setSessionsRemaining(s.sessions_remaining ?? 0);
      } catch {
        // Backend unavailable — leave empty state
      }

      setDataLoading(false);
    };

    void loadData();
  }, [user]);

  // Use loaded sessions, filtered by exam type and optional date
  const recentSessions = sessions.filter((s) => {
    if (s.examType !== examFilter) return false;
    if (dateFilter) {
      // dateFilter is "YYYY-MM-DD", s.fullDate is like "April 14, 2026"
      const sessionDate = new Date(s.fullDate);
      const sd = `${sessionDate.getFullYear()}-${String(sessionDate.getMonth() + 1).padStart(2, "0")}-${String(sessionDate.getDate()).padStart(2, "0")}`;
      if (sd !== dateFilter) return false;
    }
    return true;
  });

  const [selectedSessionId, setSelectedSessionId] = useState<string>("");
  const [modalContent, setModalContent] = useState<{
    type: "transcript" | "review";
    session: SessionData;
  } | null>(null);
  const [regenerating, setRegenerating] = useState(false);

  useEffect(() => {
    if (!modalContent) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, [modalContent]);

  // Auto-select first session when data loads
  useEffect(() => {
    if (recentSessions.length > 0 && !selectedSessionId) {
      setSelectedSessionId(recentSessions[0].id);
    }
  }, [recentSessions, selectedSessionId]);

  const selectedSession = recentSessions.find((s) => s.id === selectedSessionId) ?? recentSessions[0] ?? null;

  // Exam-filtered paid sessions (without date filter) — used for stats & calendar
  const examFilteredSessions = useMemo(
    () => sessions.filter((s) => s.examType === examFilter && !s.isDemo),
    [sessions, examFilter]
  );

  // Sessions shown in timeline/list (includes demos)
  const analyticsSessions = useMemo(
    () => recentSessions.filter((s) => !s.isDemo),
    [recentSessions]
  );

  // Compute stats from filtered sessions
  const filteredStats = useMemo(() => {
    const total = examFilteredSessions.length;
    const scores = examFilteredSessions.map((s) => s.overallScore);
    const avg = total > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / total) : 0;
    const best = total > 0 ? Math.max(...scores) : 0;

    // Streak: consecutive days with sessions (exam-specific)
    const dateSet = new Set(
      examFilteredSessions.map((s) => {
        const dt = new Date(s.fullDate);
        return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
      })
    );
    const sortedDates = [...dateSet].sort().reverse();
    let streak = 0;
    const today = new Date();
    const checkDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    for (const d of sortedDates) {
      const key = `${checkDate.getFullYear()}-${String(checkDate.getMonth() + 1).padStart(2, "0")}-${String(checkDate.getDate()).padStart(2, "0")}`;
      if (d === key) {
        streak++;
        checkDate.setDate(checkDate.getDate() - 1);
      } else if (d < key) {
        break;
      }
    }

    const lastSession = examFilteredSessions[0];
    const lastSessionDate = lastSession
      ? new Date(lastSession.fullDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })
      : "—";

    return { totalSessions: total, avgScore: avg, bestScore: best, streak, lastSessionDate };
  }, [examFilteredSessions]);

  // Practice dates filtered by exam type
  const filteredPracticeDates = useMemo(() => {
    const dates = new Set<string>();
    examFilteredSessions.forEach((s) => {
      const dt = new Date(s.fullDate);
      dates.add(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`);
    });
    return dates;
  }, [examFilteredSessions]);

  const scoreBreakdown = selectedSession
    ? [
        { label: "Pronunciation", value: selectedSession.scores.pronunciation, color: "from-blue-500 to-cyan-400" },
        { label: "Grammar", value: selectedSession.scores.grammar, color: "from-emerald-500 to-teal-400" },
        { label: "Vocabulary", value: selectedSession.scores.vocabulary, color: "from-amber-500 to-orange-400" },
        { label: "Coherence", value: selectedSession.scores.coherence, color: "from-violet-500 to-purple-400" },
      ]
    : [];

  // Chart data — oldest first, with individual skill lines
  const chartData = [...analyticsSessions].reverse().map((s, i) => ({
    date: s.date,
    index: i,
    score: s.overallScore,
    pronunciation: s.scores.pronunciation,
    grammar: s.scores.grammar,
    vocabulary: s.scores.vocabulary,
    coherence: s.scores.coherence,
  }));

  // ── Computed Analytics ──

  // Average scores across all sessions
  const n = analyticsSessions.length || 1;
  const pronunciationValues = analyticsSessions
    .map((s) => s.scores.pronunciation)
    .filter((v): v is number => v !== null);
  const avgScores = {
    pronunciation: pronunciationValues.length > 0
      ? Math.round(pronunciationValues.reduce((a, b) => a + b, 0) / pronunciationValues.length)
      : 0,
    grammar: Math.round(analyticsSessions.reduce((a, s) => a + s.scores.grammar, 0) / n),
    vocabulary: Math.round(analyticsSessions.reduce((a, s) => a + s.scores.vocabulary, 0) / n),
    coherence: Math.round(analyticsSessions.reduce((a, s) => a + s.scores.coherence, 0) / n),
  };

  // Weakest area
  const skillEntries = Object.entries(avgScores) as [string, number][];
  const weakest = skillEntries.length > 0
    ? skillEntries.reduce((min, e) => (e[1] < min[1] ? e : min))
    : ["pronunciation", 0] as [string, number];
  const weakestLabel = weakest[0].charAt(0).toUpperCase() + weakest[0].slice(1);
  const weakestTips: Record<string, string> = {
    pronunciation: "Focus on nasal vowels (an, en, on), the French 'r', and linking between words (liaison).",
    grammar: "Practice past tenses (passe compose vs imparfait), subjunctive mood, and article agreements.",
    vocabulary: "Expand with idiomatic expressions, connectors (however, nevertheless), and topic-specific words.",
    coherence: "Structure answers with introduction, development, conclusion. Use transition phrases between ideas.",
  };

  // Part performance — average score per exam part
  const partScores: Record<number, { total: number; count: number }> = {};
  analyticsSessions.forEach((s) => {
    s.partsCompleted.forEach((p) => {
      if (!partScores[p]) partScores[p] = { total: 0, count: 0 };
      partScores[p].total += s.overallScore;
      partScores[p].count++;
    });
  });
  const partData = [1, 2, 3].map((p) => ({
    part: `Part ${p}`,
    score: partScores[p] ? Math.round(partScores[p].total / partScores[p].count) : 0,
    sessions: partScores[p]?.count ?? 0,
  }));

  // Radar data for part performance
  const radarData = [
    { skill: "Pronunciation", value: avgScores.pronunciation },
    { skill: "Grammar", value: avgScores.grammar },
    { skill: "Vocabulary", value: avgScores.vocabulary },
    { skill: "Coherence", value: avgScores.coherence },
  ];

  // Level readiness — based on recent 3 sessions avg
  const recent3 = analyticsSessions.slice(0, 3);
  const recent3Avg = recent3.length > 0
    ? Math.round(recent3.reduce((a, s) => a + s.overallScore, 0) / recent3.length)
    : 0;
  const levelThresholds = [
    { level: "A2", min: 40, color: "from-slate-400 to-slate-500" },
    { level: "B1", min: 55, color: "from-emerald-500 to-teal-400" },
    { level: "B2", min: 70, color: "from-blue-500 to-cyan-400" },
    { level: "C1", min: 85, color: "from-violet-500 to-purple-400" },
  ];
  const levelReadiness = levelThresholds.map((l) => ({
    ...l,
    readiness: Math.min(100, Math.round((recent3Avg / l.min) * 100)),
  }));

  // Common mistakes — dynamically generated from score weaknesses + correction patterns
  const commonMistakes = useMemo(() => {
    if (analyticsSessions.length === 0) return [];

    const mistakes: { area: string; frequency: number; severity: "high" | "medium" | "low" }[] = [];

    // 1. Primary: derive from actual score categories (most reliable)
    const scoreWeaknesses = (Object.entries(avgScores) as [string, number][])
      .filter(([, v]) => v < 70) // flag anything below 70%
      .sort((a, b) => a[1] - b[1])
      .map(([key, val]) => ({
        area: key === "pronunciation" ? "Pronunciation Accuracy" :
              key === "grammar" ? "Grammar & Conjugation" :
              key === "vocabulary" ? "Vocabulary Breadth" :
              "Coherence & Flow",
        frequency: analyticsSessions.filter((s) => {
          const score = s.scores[key as keyof typeof s.scores];
          return typeof score === "number" && score < 50;
        }).length,
        severity: (val < 30 ? "high" : val < 50 ? "medium" : "low") as "high" | "medium" | "low",
      }));

    scoreWeaknesses.forEach((sw) => {
      if (sw.frequency > 0 && mistakes.length < 5) {
        mistakes.push(sw);
      }
    });

    // 2. Secondary: count unique correction themes per session (not per correction)
    // This prevents one verbose session from inflating counts
    const patternLabels = [
      { label: "Verb Conjugation", keywords: /conjugai|verbe|conditionnel|subjonctif|imparfait|passé composé|futur/i },
      { label: "Article & Gender", keywords: /\b(article|genre|masculin|féminin)\b|accord de l'/i },
      { label: "Sentence Completeness", keywords: /incomplèt|incomplet|réponse complète|phrase complète/i },
      { label: "Word Choice", keywords: /\b(vocabulaire|lexique|synonyme|expression idiomatique)\b/i },
      { label: "Sentence Structure", keywords: /\b(structure|syntaxe|ordre des mots)\b/i },
    ];

    const patternCounts = new Map<string, number>();
    analyticsSessions.forEach((s) => {
      // Collect all correction text for this session
      const sessionTexts = s.corrections.map((c) => [c.text, c.feedback].filter(Boolean).join(" ")).join(" ");
      if (!sessionTexts) return;
      // Count each pattern at most once per session
      patternLabels.forEach((p) => {
        if (p.keywords.test(sessionTexts)) {
          patternCounts.set(p.label, (patternCounts.get(p.label) || 0) + 1);
        }
      });
    });

    // Add correction-based items that don't duplicate score-derived ones
    const existingAreas = new Set(mistakes.map((m) => m.area));
    [...patternCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .forEach(([area, freq]) => {
        if (!existingAreas.has(area) && mistakes.length < 5) {
          mistakes.push({
            area,
            frequency: freq,
            severity: freq >= 3 ? "high" : freq >= 2 ? "medium" : "low",
          });
        }
      });

    return mistakes.slice(0, 5);
  }, [analyticsSessions, avgScores]);

  // Practice consistency — calendar-based with month navigation
  const practiceDates = filteredPracticeDates;

  const [calMonth, setCalMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });

  const calendarGrid = useMemo(() => {
    const { year, month } = calMonth;
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    // 0=Sun, convert to Mon-start: Mon=0..Sun=6
    const startDow = (firstDay.getDay() + 6) % 7;

    const cells: (number | null)[] = [];
    // pad before
    for (let i = 0; i < startDow; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    // pad after to complete last week
    while (cells.length % 7 !== 0) cells.push(null);

    // split into weeks
    const weeks: (number | null)[][] = [];
    for (let i = 0; i < cells.length; i += 7) {
      weeks.push(cells.slice(i, i + 7));
    }
    return { weeks, daysInMonth, year, month };
  }, [calMonth]);

  const calMonthName = new Date(calMonth.year, calMonth.month).toLocaleString("en-US", { month: "long" });

  const monthOptions = Array.from({ length: 12 }, (_, i) => ({
    value: i,
    label: new Date(2026, i).toLocaleString("en-US", { month: "short" }),
  }));

  const currentYear = new Date().getFullYear();
  const yearOptions = Array.from({ length: 5 }, (_, i) => currentYear - 4 + i);

  const calSessionCount = useMemo(() => {
    const { year, month } = calMonth;
    let count = 0;
    examFilteredSessions.forEach((s) => {
      const dt = new Date(s.fullDate);
      if (dt.getFullYear() === year && dt.getMonth() === month) count++;
    });
    return count;
  }, [calMonth, examFilteredSessions]);

  const dayLabels = ["M", "T", "W", "T", "F", "S", "S"];

  return (
    <div className="min-h-screen bg-[var(--background)] relative noise-overlay">
      {/* Background */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <div className="absolute top-[-20%] left-[-10%] w-[55%] h-[55%] rounded-full bg-indigo-600/15 blur-[150px]" />
        <div className="absolute bottom-[-15%] right-[-5%] w-[40%] h-[40%] rounded-full bg-violet-600/10 blur-[120px]" />
      </div>

      {/* Header */}
      <header className="sticky top-0 z-50 glass-panel border-b border-white/[0.06]">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-3 group">
            <div className="rounded-xl bg-gradient-to-tr from-indigo-500 to-violet-500 p-2.5 text-white shadow-lg shadow-indigo-500/25 transition-all duration-300 group-hover:shadow-indigo-500/40 group-hover:scale-105">
              <Mic size={18} />
            </div>
            <span className="text-2xl font-bold tracking-tight text-white">SpeakFrench</span>
          </Link>

          <nav className="hidden items-center gap-6 text-sm font-medium text-slate-400 md:flex">
            <Link href="/" className="hover:text-white transition-colors duration-200">Home</Link>
            <Link href="/pricing" className="hover:text-white transition-colors duration-200">Pricing</Link>
            <Link href="/profile" className="hover:text-white transition-colors duration-200 flex items-center gap-1.5">
              <User size={14} />
              Profile
            </Link>
            {isAdmin && (
              <Link href="/admin" className="hover:text-white transition-colors duration-200 flex items-center gap-1.5 text-amber-400 hover:text-amber-300">
                <Shield size={14} />
                Admin
              </Link>
            )}
            <Link href="/session" className="btn-primary px-5 py-2.5 flex items-center gap-2 text-sm">
              <Play size={14} className="fill-current" />
              <span>Start Session</span>
            </Link>
          </nav>
        </div>
      </header>

      <div className="relative z-10 mx-auto max-w-7xl px-6 py-10">
        {/* Welcome Banner */}
        <motion.div {...fadeUp(0)} className="mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">
            Welcome back{user?.user_metadata?.full_name ? `, ${user.user_metadata.full_name.split(" ")[0]}` : ""}! 👋
          </h1>
          <p className="text-slate-400">Track your progress, review past sessions, and start practicing.</p>
        </motion.div>

        {(authLoading || dataLoading) && (
          <div className="flex items-center justify-center py-20">
            <div className="text-slate-400 text-sm">Loading your dashboard...</div>
          </div>
        )}

        {!authLoading && !dataLoading && (
        <>

        {/* Quick Actions */}
        <motion.div
          {...fadeUp(0.05)}
          className={`grid gap-4 ${demoUsed ? "md:grid-cols-1" : "md:grid-cols-2"} mb-8`}
        >
          <Link href="/session" className="glass-card p-6 flex items-center gap-5 group hover:border-indigo-400/30 transition-all">
            <div className="rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 p-4 text-white shadow-lg shadow-indigo-500/25 transition-transform duration-300 group-hover:scale-110">
              <Mic size={28} />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-white mb-1">Start New Session</h3>
              <p className="text-sm text-slate-400">Practice with the AI examiner on all TCF/TEF parts.</p>
            </div>
            <ArrowRight size={20} className="text-slate-500 group-hover:text-indigo-400 transition-colors" />
          </Link>

          {!demoUsed && (
            <Link href="/session?demo=true" className="glass-card p-6 flex items-center gap-5 group hover:border-emerald-400/30 transition-all">
              <div className="rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-500 p-4 text-white shadow-lg shadow-emerald-500/25 transition-transform duration-300 group-hover:scale-110">
                <BookOpen size={28} />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-white mb-1">Quick Demo</h3>
                <p className="text-sm text-slate-400">Try a free 3-4 minute demo session (Part 1 only).</p>
              </div>
              <ArrowRight size={20} className="text-slate-500 group-hover:text-emerald-400 transition-colors" />
            </Link>
          )}
        </motion.div>

        {/* Exam Type Filter */}
        <motion.div {...fadeUp(0.08)} className="flex items-center gap-2 mb-8">
          <span className="text-xs text-slate-500 font-medium mr-2">Exam:</span>
          {([
            { value: "tcf" as const, label: "TCF" },
            { value: "tef" as const, label: "TEF" },
          ]).map((opt) => (
            <button
              key={opt.value}
              onClick={() => { setExamFilter(opt.value); setSelectedSessionId(""); setDateFilter(null); }}
              className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-all ${
                examFilter === opt.value
                  ? "bg-gradient-to-r from-indigo-500 to-violet-500 text-white shadow-lg shadow-indigo-500/25"
                  : "bg-white/[0.06] text-slate-400 border border-white/[0.08] hover:bg-white/[0.1] hover:text-white"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </motion.div>

        {/* Stats Grid */}
        <motion.div {...fadeUp(0.1)} className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-6 mb-8">
          {[
            { icon: Target, label: "Total Sessions", value: String(filteredStats.totalSessions), gradient: "from-blue-500 to-cyan-400" },
            { icon: TrendingUp, label: "Avg Score", value: `${filteredStats.avgScore}/100`, gradient: "from-emerald-500 to-teal-400" },
            { icon: Trophy, label: "Best Score", value: `${filteredStats.bestScore}/100`, gradient: "from-amber-500 to-orange-400" },
            { icon: CreditCard, label: "Sessions Left", value: String(sessionsRemaining), gradient: "from-indigo-500 to-violet-400" },
            { icon: Sparkles, label: "Day Streak", value: `${filteredStats.streak} day${filteredStats.streak !== 1 ? "s" : ""}`, gradient: "from-rose-500 to-pink-400" },
            { icon: Calendar, label: "Last Session", value: filteredStats.lastSessionDate, gradient: "from-cyan-500 to-blue-400" },
          ].map((stat, i) => (
            <motion.div key={i} {...fadeUp(0.1 + i * 0.05)} className="glass-card p-4">
              <div className={`inline-flex rounded-xl bg-gradient-to-br ${stat.gradient} p-2 text-white mb-3`}>
                <stat.icon size={16} />
              </div>
              <p className="text-lg font-bold text-white">{stat.value}</p>
              <p className="text-xs text-slate-500">{stat.label}</p>
            </motion.div>
          ))}
        </motion.div>

        {/* Sessions + Score Breakdown + Graph */}
        <div className="grid gap-6 lg:grid-cols-5 items-start" style={{ overflow: "visible" }}>
          {/* Left Column: Score Breakdown + Progress Graph */}
          <div className="lg:col-span-2 flex flex-col gap-6" style={{ overflow: "visible" }}>
            {/* Score Breakdown */}
            <motion.div {...fadeUp(0.15)} className="glass-card px-4 py-3.5">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1.5">
                  <BarChart3 size={12} className="text-indigo-400" />
                  <h3 className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Score Breakdown</h3>
                </div>
                {selectedSession && (
                  <span className="text-[10px] text-slate-500">{selectedSession.fullDate} · Level {selectedSession.level}</span>
                )}
              </div>

              {selectedSession ? (
              <AnimatePresence mode="wait">
                <motion.div
                  key={selectedSession.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-2 mt-2.5"
                >
                  {scoreBreakdown.map((item, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <span className="text-[11px] text-slate-400 w-24 shrink-0">{item.label}</span>
                      <div className="flex-1 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${item.value ?? 0}%` }}
                          transition={{ duration: 0.8, delay: i * 0.08, ease: [0.16, 1, 0.3, 1] as const }}
                          className={`h-full rounded-full bg-gradient-to-r ${item.color}`}
                        />
                      </div>
                      <span className="text-[11px] font-semibold text-white w-16 text-right">{item.value === null ? "N/A" : `${item.value}/100`}</span>
                    </div>
                  ))}
                </motion.div>
              </AnimatePresence>
              ) : (
                <p className="text-xs text-slate-500 mt-3">No sessions yet. Start practicing to see your scores.</p>
              )}

              {selectedSession && (
              <div className="mt-2.5 pt-2 border-t border-white/[0.06] flex items-center justify-between">
                <span className="text-[11px] text-slate-400">Overall</span>
                <span className="text-lg font-bold text-white">
                  {selectedSession.overallScore}<span className="text-[10px] text-slate-500">/100</span>
                </span>
              </div>
              )}
            </motion.div>

            {/* Skill Trends Over Time */}
            <motion.div {...fadeUp(0.25)} className="glass-card p-5" style={{ overflow: "visible" }}>
              <div className="flex items-center gap-2 mb-4">
                <TrendingUp size={14} className="text-indigo-400" />
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Skill Trends</h3>
              </div>
              <div className="h-52" style={{ overflow: "visible" }}>
                  <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                    <LineChart data={chartData} margin={{ top: 5, right: 15, bottom: 5, left: -10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                      <XAxis
                        dataKey="index"
                        stroke="#64748b"
                        fontSize={11}
                        tickLine={false}
                        axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
                        tickFormatter={(idx: number) => chartData[idx]?.date ?? ""}
                      />
                      <YAxis
                        stroke="#64748b"
                        fontSize={11}
                        tickLine={false}
                        axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
                        domain={[0, 100]}
                      />
                      <Tooltip
                        wrapperStyle={{ zIndex: 1000, pointerEvents: "none" }}
                        allowEscapeViewBox={{ x: true, y: true }}
                        contentStyle={{
                          background: "rgba(15, 23, 42, 0.95)",
                          border: "1px solid rgba(255,255,255,0.1)",
                          borderRadius: "0.75rem",
                          boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
                          fontSize: 11,
                          pointerEvents: "none",
                        }}
                        labelStyle={{ color: "#94a3b8", fontSize: 11 }}
                        labelFormatter={(idx: number) => chartData[idx]?.date ?? ""}
                        cursor={{ stroke: "rgba(255,255,255,0.15)", strokeWidth: 1 }}
                      />
                      <Legend
                        iconSize={8}
                        wrapperStyle={{ fontSize: 10, color: "#94a3b8" }}
                      />
                      <Line type="monotone" dataKey="score" name="Overall" stroke="#818cf8" strokeWidth={2.5} dot={{ r: 3 }} />
                      <Line type="monotone" dataKey="pronunciation" name="Pronunc." stroke="#38bdf8" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
                      <Line type="monotone" dataKey="grammar" name="Grammar" stroke="#34d399" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
                      <Line type="monotone" dataKey="vocabulary" name="Vocab." stroke="#fb923c" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
                      <Line type="monotone" dataKey="coherence" name="Coherence" stroke="#c084fc" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
                    </LineChart>
                  </ResponsiveContainer>
              </div>
            </motion.div>
          </div>

          {/* Right Column: Recent Sessions (scrollable) */}
          <motion.div {...fadeUp(0.2)} className="glass-card p-5 lg:col-span-3">
            <div className="flex items-center gap-2 mb-4">
              <Clock3 size={14} className="text-indigo-400" />
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Recent Sessions</h3>
              {dateFilter && (
                <button
                  onClick={() => setDateFilter(null)}
                  className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-indigo-500/15 border border-indigo-400/20 px-2.5 py-1 text-[10px] font-medium text-indigo-300 hover:bg-indigo-500/25 transition-colors"
                >
                  <CalendarDays size={10} />
                  {new Date(dateFilter + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  <X size={10} />
                </button>
              )}
            </div>

            <div className="overflow-y-auto max-h-[420px] pr-1 space-y-2 scrollbar-thin">
              {recentSessions.map((session) => {
                const isSelected = session.id === selectedSessionId;
                const scoreColor =
                  session.isDemo
                    ? "text-cyan-300 bg-cyan-500/10 border-cyan-400/20"
                    : session.overallScore >= 80
                    ? "text-emerald-400 bg-emerald-500/10 border-emerald-400/20"
                    : session.overallScore >= 65
                      ? "text-amber-400 bg-amber-500/10 border-amber-400/20"
                      : "text-red-400 bg-red-500/10 border-red-400/20";

                return (
                  <div
                    key={session.id}
                    onClick={() => setSelectedSessionId(session.id)}
                    className={`cursor-pointer rounded-lg border px-3 py-2.5 transition-all duration-200 ${
                      isSelected
                        ? "bg-indigo-500/10 border-indigo-400/30 shadow-lg shadow-indigo-500/5"
                        : "bg-white/[0.03] border-white/[0.05] hover:bg-white/[0.05]"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <span className="text-[11px] text-slate-500 font-medium w-14 shrink-0">{session.date}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                            <span className={`text-[9px] font-semibold px-1.5 py-px rounded-full border ${
                              session.examType === "tef"
                                ? "bg-amber-500/15 text-amber-300 border-amber-400/20"
                                : "bg-indigo-500/15 text-indigo-300 border-indigo-400/20"
                            }`}>
                              {session.examType.toUpperCase()}
                            </span>
                            {session.isDemo && (
                              <span className="text-[9px] font-semibold px-1.5 py-px rounded-full border bg-cyan-500/15 text-cyan-300 border-cyan-400/20">
                                DEMO
                              </span>
                            )}
                            <span className="text-[11px] text-slate-500 font-medium">Level {session.level}</span>
                            <span className="text-slate-600 text-[10px]">·</span>
                            <span
                              className="text-[9px] font-semibold px-1.5 py-px rounded-full bg-indigo-500/15 text-indigo-300 border border-indigo-400/20"
                            >
                              {session.partsCompleted.length === 1
                                ? `Part ${session.partsCompleted[0]}`
                                : `Parts ${session.partsCompleted.join("+")}`}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setModalContent({ type: "transcript", session });
                              }}
                              className="text-[10px] font-medium text-slate-400 hover:text-indigo-400 transition-colors flex items-center gap-0.5"
                            >
                              <FileText size={10} />
                              Transcript
                            </button>
                            <span className="text-slate-700 text-[10px]">|</span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setModalContent({ type: "review", session });
                              }}
                              className="text-[10px] font-medium text-slate-400 hover:text-violet-400 transition-colors flex items-center gap-0.5"
                            >
                              <MessageSquare size={10} />
                              Review
                            </button>
                          </div>
                        </div>
                      </div>
                      <span className={`rounded-md border px-2.5 py-0.5 text-xs font-bold shrink-0 ${scoreColor}`}>
                        {session.isDemo ? "Demo" : session.overallScore}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-3 pt-3 border-t border-white/[0.06] text-center">
              <p className="text-xs text-slate-500">Click a session to view its score breakdown.</p>
            </div>
          </motion.div>
        </div>

        {/* ── Analytics Section ── */}
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 mt-8">

          {/* Level Readiness */}
          <motion.div {...fadeUp(0.3)} className="glass-card px-5 py-4">
            <div className="flex items-center gap-2 mb-3">
              <Gauge size={14} className="text-indigo-400" />
              <h3 className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Level Readiness</h3>
            </div>
            <p className="text-[10px] text-slate-500 mb-3">Based on your last 3 sessions (avg: {recent3Avg})</p>
            <div className="space-y-2.5">
              {levelReadiness.map((l) => (
                <div key={l.level} className="flex items-center gap-3">
                  <span className="text-[11px] font-bold text-white w-6">{l.level}</span>
                  <div className="flex-1 h-2 overflow-hidden rounded-full bg-white/[0.06]">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.min(l.readiness, 100)}%` }}
                      transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] as const }}
                      className={`h-full rounded-full bg-gradient-to-r ${l.color}`}
                    />
                  </div>
                  <span className={`text-[11px] font-semibold w-10 text-right ${l.readiness >= 100 ? "text-emerald-400" : "text-slate-400"}`}>
                    {l.readiness >= 100 ? "✓ Ready" : `${l.readiness}%`}
                  </span>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Weakest Area + Focus */}
          <motion.div {...fadeUp(0.35)} className="glass-card px-5 py-4">
            <div className="flex items-center gap-2 mb-3">
              <Crosshair size={14} className="text-amber-400" />
              <h3 className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Focus Area</h3>
            </div>
            <div className="flex items-center gap-3 mb-3">
              <div className="rounded-xl bg-amber-500/15 border border-amber-400/20 px-3 py-1.5">
                <span className="text-sm font-bold text-amber-400">{weakestLabel}</span>
              </div>
              <span className="text-[11px] text-slate-500">avg {weakest[1]}% — your lowest skill</span>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed mb-4">{weakestTips[weakest[0]]}</p>

            {/* Skill radar mini */}
            <div className="h-40 -mx-2">
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <RadarChart data={radarData} outerRadius="70%">
                  <PolarGrid stroke="rgba(255,255,255,0.08)" />
                  <PolarAngleAxis dataKey="skill" tick={{ fontSize: 10, fill: "#94a3b8" }} />
                  <PolarRadiusAxis tick={false} axisLine={false} domain={[0, 100]} />
                  <Radar dataKey="value" stroke="#818cf8" fill="#6366f1" fillOpacity={0.2} strokeWidth={2} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          </motion.div>

          {/* Common Mistakes */}
          <motion.div {...fadeUp(0.4)} className="glass-card px-5 py-4">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle size={14} className="text-rose-400" />
              <h3 className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Common Mistakes</h3>
            </div>
            <div className="space-y-2">
              {commonMistakes.length === 0 ? (
                <p className="text-[11px] text-slate-500 italic py-3">Complete more sessions to identify patterns.</p>
              ) : commonMistakes.map((m, i) => {
                const sevColor =
                  m.severity === "high"
                    ? "text-rose-400 bg-rose-500/10 border-rose-400/20"
                    : m.severity === "medium"
                      ? "text-amber-400 bg-amber-500/10 border-amber-400/20"
                      : "text-slate-400 bg-white/[0.04] border-white/[0.08]";
                return (
                  <div key={i} className="flex items-center justify-between rounded-lg bg-white/[0.03] border border-white/[0.05] px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-slate-300">{m.area}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-slate-500">{m.frequency}×</span>
                      <span className={`text-[9px] font-semibold px-1.5 py-px rounded-full border ${sevColor}`}>
                        {m.severity}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        </div>

        {/* Part Performance + Practice Consistency */}
        <div className="grid gap-6 md:grid-cols-2 mt-6">
          {/* Part Performance */}
          <motion.div {...fadeUp(0.45)} className="glass-card px-5 py-4">
            <div className="flex items-center gap-2 mb-4">
              <BarChart3 size={14} className="text-indigo-400" />
              <h3 className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Performance by Exam Part</h3>
            </div>
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <BarChart data={partData} margin={{ top: 5, right: 10, bottom: 5, left: -15 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="part" stroke="#64748b" fontSize={11} tickLine={false} />
                  <YAxis stroke="#64748b" fontSize={11} tickLine={false} domain={[0, 100]} />
                  <Tooltip
                    contentStyle={{
                      background: "rgba(15, 23, 42, 0.95)",
                      border: "1px solid rgba(255,255,255,0.1)",
                      borderRadius: "0.75rem",
                      fontSize: 11,
                    }}
                    formatter={(value: number, name: string) => {
                      if (name === "score") return [`${value}/100`, "Avg Score"];
                      return [`${value}`, "Sessions"];
                    }}
                  />
                  <Bar dataKey="score" fill="#818cf8" radius={[6, 6, 0, 0]} barSize={32} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="flex justify-center gap-6 mt-2">
              {partData.map((p) => (
                <div key={p.part} className="text-center">
                  <p className="text-[11px] text-slate-500">{p.part}</p>
                  <p className="text-[10px] text-slate-600">{p.sessions} session{p.sessions !== 1 ? "s" : ""}</p>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Practice Consistency */}
          <motion.div {...fadeUp(0.5)} className="glass-card px-5 py-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <CalendarDays size={14} className="text-emerald-400" />
                <h3 className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Practice Consistency</h3>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setCalMonth((p) => {
                    const d = new Date(p.year, p.month - 1);
                    return { year: d.getFullYear(), month: d.getMonth() };
                  })}
                  className="text-slate-400 hover:text-white transition-colors px-1 py-0.5 rounded hover:bg-white/[0.06] text-xs"
                >
                  ‹
                </button>
                <select
                  value={calMonth.month}
                  onChange={(e) => setCalMonth((p) => ({ ...p, month: Number(e.target.value) }))}
                  className="bg-white/[0.06] border border-white/[0.08] rounded-md text-[11px] text-slate-300 px-1.5 py-0.5 outline-none focus:border-indigo-400/40 appearance-none cursor-pointer"
                >
                  {monthOptions.map((m) => (
                    <option key={m.value} value={m.value} className="bg-slate-900">{m.label}</option>
                  ))}
                </select>
                <select
                  value={calMonth.year}
                  onChange={(e) => setCalMonth((p) => ({ ...p, year: Number(e.target.value) }))}
                  className="bg-white/[0.06] border border-white/[0.08] rounded-md text-[11px] text-slate-300 px-1.5 py-0.5 outline-none focus:border-indigo-400/40 appearance-none cursor-pointer"
                >
                  {yearOptions.map((y) => (
                    <option key={y} value={y} className="bg-slate-900">{y}</option>
                  ))}
                </select>
                <button
                  onClick={() => {
                    const now = new Date();
                    const cur = new Date(calMonth.year, calMonth.month);
                    if (cur < new Date(now.getFullYear(), now.getMonth())) {
                      setCalMonth((p) => {
                        const d = new Date(p.year, p.month + 1);
                        return { year: d.getFullYear(), month: d.getMonth() };
                      });
                    }
                  }}
                  className={`px-1 py-0.5 rounded text-xs transition-colors ${
                    new Date(calMonth.year, calMonth.month) >= new Date(new Date().getFullYear(), new Date().getMonth())
                      ? "text-slate-700 cursor-not-allowed"
                      : "text-slate-400 hover:text-white hover:bg-white/[0.06]"
                  }`}
                >
                  ›
                </button>
              </div>
            </div>

            {/* Day headers */}
            <div className="grid grid-cols-7 gap-1 mb-1">
              {dayLabels.map((d, i) => (
                <div key={i} className="text-center text-[9px] font-medium text-slate-600">{d}</div>
              ))}
            </div>

            {/* Calendar grid */}
            <div className="space-y-1">
              {calendarGrid.weeks.map((week, wi) => (
                <div key={wi} className="grid grid-cols-7 gap-1">
                  {week.map((day, di) => {
                    if (day === null) {
                      return <div key={di} className="h-7 rounded-md" />;
                    }
                    const dateStr = `${calMonth.year}-${String(calMonth.month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                    const active = practiceDates.has(dateStr);
                    const isToday =
                      calMonth.year === new Date().getFullYear() &&
                      calMonth.month === new Date().getMonth() &&
                      day === new Date().getDate();
                    const isFilteredDate = dateFilter === dateStr;
                    return (
                      <div
                        key={di}
                        onClick={() => {
                          if (active) {
                            setDateFilter(isFilteredDate ? null : dateStr);
                          }
                        }}
                        className={`h-7 rounded-md flex items-center justify-center text-[10px] font-medium transition-colors ${
                          isFilteredDate
                            ? "bg-indigo-500/30 text-indigo-300 border border-indigo-400/40 ring-1 ring-indigo-400/50"
                            : active
                              ? "bg-emerald-500/25 text-emerald-400 border border-emerald-400/20 cursor-pointer hover:bg-emerald-500/35"
                              : "bg-white/[0.03] text-slate-600 border border-white/[0.04]"
                        } ${isToday && !isFilteredDate ? "ring-1 ring-indigo-400/50" : ""}`}
                      >
                        {day}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>

            <div className="mt-3 pt-3 border-t border-white/[0.06] flex items-center justify-between">
              <span className="text-[11px] text-slate-400">Sessions this month</span>
              <span className="text-sm font-bold text-white">{calSessionCount} session{calSessionCount !== 1 ? "s" : ""}</span>
            </div>
          </motion.div>
        </div>

        {/* Buy More Sessions CTA */}
        <motion.div {...fadeUp(0.3)} className="mt-8 glass-card p-8 flex flex-col md:flex-row items-center justify-between gap-6 relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-indigo-600/5 via-violet-600/5 to-transparent pointer-events-none" />
          <div className="relative">
            <h3 className="text-xl font-bold text-white mb-1">Need more sessions?</h3>
            <p className="text-slate-400">Buy a pack to keep practicing. Sessions never expire.</p>
          </div>
          <Link href="/pricing" className="relative btn-primary px-6 py-3 flex items-center gap-2 whitespace-nowrap">
            <CreditCard size={18} />
            <span>View Packs</span>
            <ChevronRight size={16} />
          </Link>
        </motion.div>

        </>
        )}
      </div>

      {/* Transcript / Review Modal */}
      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {modalContent && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm overflow-hidden"
                onClick={() => setModalContent(null)}
              >
                <motion.div
                  initial={{ opacity: 0, scale: 0.95, y: 20 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: 20 }}
                  transition={{ duration: 0.2 }}
                  onClick={(e) => e.stopPropagation()}
                  className="glass-card max-w-2xl w-full h-[80vh] max-h-[80vh] overflow-hidden border border-white/[0.1] flex flex-col"
                >
                  <div className="flex items-center justify-between mb-4 p-6 pb-0 shrink-0">
                    <h3 className="text-lg font-semibold text-white">
                      {modalContent.type === "transcript" ? "Session Transcript" : "AI Review"}
                    </h3>
                    <button
                      onClick={() => setModalContent(null)}
                      className="text-slate-400 hover:text-white transition-colors p-1 rounded-lg hover:bg-white/[0.06]"
                    >
                      <X size={20} />
                    </button>
                  </div>

                  <p className="text-xs text-slate-500 mb-5 px-6 shrink-0">
                    {modalContent.session.fullDate} · Level {modalContent.session.level} ·{" "}
                    {modalContent.session.partsCompleted.length === 1
                      ? `Part ${modalContent.session.partsCompleted[0]}`
                      : `Parts ${modalContent.session.partsCompleted.join("+")}`}
                  </p>

                  <div className="px-6 pb-6 overflow-y-auto flex-1 min-h-0">
                    {modalContent.type === "transcript" ? (
                      <div className="space-y-3">
                        {(() => {
                          const entries = modalContent.session.transcript;
                          let lastPart: number | undefined = undefined;
                          return entries.map((entry, i) => {
                            const showDivider = entry.part !== undefined && entry.part !== lastPart;
                            if (showDivider) lastPart = entry.part;
                            return (
                              <div key={i}>
                                {showDivider && (
                                  <div className="flex items-center gap-3 my-4">
                                    <div className="flex-1 h-px bg-gradient-to-r from-transparent via-indigo-400/30 to-transparent" />
                                    <span className="text-[10px] uppercase tracking-widest font-semibold text-indigo-300/80 px-2">
                                      Part {entry.part}
                                    </span>
                                    <div className="flex-1 h-px bg-gradient-to-r from-transparent via-indigo-400/30 to-transparent" />
                                  </div>
                                )}
                                <div className={`flex ${entry.speaker === "examiner" ? "justify-start" : "justify-end"}`}>
                                  <div
                                    className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                                      entry.speaker === "examiner"
                                        ? "bg-indigo-500/10 border border-indigo-400/15 text-slate-200"
                                        : "bg-emerald-500/10 border border-emerald-400/15 text-slate-200"
                                    }`}
                                  >
                                    <p className="text-[10px] uppercase tracking-wider font-semibold mb-1 text-slate-500">
                                      {entry.speaker === "examiner" ? "Examiner" : "You"}
                                    </p>
                                    <p className="text-sm leading-relaxed">{entry.text}</p>
                                  </div>
                                </div>
                              </div>
                            );
                          });
                        })()}
                      </div>
                    ) : modalContent.session.review === "No AI review available for this session." ? (
                      <div className="text-center py-8">
                        <p className="text-sm text-slate-400 mb-4">No AI review was generated for this session.</p>
                        <button
                          onClick={async () => {
                            if (!user) return;
                            setRegenerating(true);
                            try {
                              const result = await regenerateReview(user.id, modalContent.session.id);
                              if (result.ai_review) {
                                // Update the session in state
                                setSessions((prev) =>
                                  prev.map((s) =>
                                    s.id === modalContent.session.id ? { ...s, review: result.ai_review } : s
                                  )
                                );
                                setModalContent({
                                  ...modalContent,
                                  session: { ...modalContent.session, review: result.ai_review },
                                });
                              }
                            } catch {
                              // silently fail
                            } finally {
                              setRegenerating(false);
                            }
                          }}
                          disabled={regenerating}
                          className="btn-primary px-6 py-2 text-sm font-semibold text-white inline-flex items-center gap-2 disabled:opacity-50"
                        >
                          {regenerating ? (
                            <>
                              <div className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                              Generating...
                            </>
                          ) : (
                            <>
                              <Sparkles size={14} />
                              Generate Review
                            </>
                          )}
                        </button>
                      </div>
                    ) : (
                      <div className="bg-violet-500/10 border border-violet-400/15 rounded-xl px-5 py-4">
                        <ReviewMarkdown content={modalContent.session.review} />
                      </div>
                    )}
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )}
    </div>
  );
}
