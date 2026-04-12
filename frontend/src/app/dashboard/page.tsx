"use client";

import Link from "next/link";
import { motion } from "framer-motion";
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
} from "lucide-react";

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 24 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.5, delay, ease: [0.16, 1, 0.3, 1] as const } },
});

export default function DashboardPage() {
  // TODO: Replace with real data from Supabase
  const stats = {
    totalSessions: 12,
    avgScore: 74,
    bestScore: 89,
    sessionsRemaining: 8,
    streak: 5,
    lastSessionDate: "Apr 10, 2026",
  };

  const recentSessions = [
    { date: "Apr 10", part: "Part 1 - Presentation", score: 82, level: "B2" },
    { date: "Apr 8", part: "Part 3 - Opinion", score: 76, level: "B2" },
    { date: "Apr 6", part: "Part 2 - Conversation", score: 71, level: "B1" },
    { date: "Apr 4", part: "Part 1 - Presentation", score: 68, level: "B1" },
  ];

  const scoreBreakdown = [
    { label: "Pronunciation", value: 78, color: "from-blue-500 to-cyan-400" },
    { label: "Grammar", value: 72, color: "from-emerald-500 to-teal-400" },
    { label: "Vocabulary", value: 69, color: "from-amber-500 to-orange-400" },
    { label: "Coherence", value: 76, color: "from-violet-500 to-purple-400" },
  ];

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
          <h1 className="text-3xl font-bold text-white mb-2">Welcome back! 👋</h1>
          <p className="text-slate-400">Track your progress, review past sessions, and start practicing.</p>
        </motion.div>

        {/* Quick Actions */}
        <motion.div {...fadeUp(0.05)} className="grid gap-4 md:grid-cols-2 mb-8">
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
        </motion.div>

        {/* Stats Grid */}
        <motion.div {...fadeUp(0.1)} className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-6 mb-8">
          {[
            { icon: Target, label: "Total Sessions", value: String(stats.totalSessions), gradient: "from-blue-500 to-cyan-400" },
            { icon: TrendingUp, label: "Avg Score", value: `${stats.avgScore}/100`, gradient: "from-emerald-500 to-teal-400" },
            { icon: Trophy, label: "Best Score", value: `${stats.bestScore}/100`, gradient: "from-amber-500 to-orange-400" },
            { icon: CreditCard, label: "Sessions Left", value: String(stats.sessionsRemaining), gradient: "from-indigo-500 to-violet-400" },
            { icon: Sparkles, label: "Day Streak", value: `${stats.streak} days`, gradient: "from-rose-500 to-pink-400" },
            { icon: Calendar, label: "Last Session", value: stats.lastSessionDate, gradient: "from-cyan-500 to-blue-400" },
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

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Score Breakdown */}
          <motion.div {...fadeUp(0.15)} className="glass-card p-6 lg:col-span-1">
            <div className="flex items-center gap-2 mb-5">
              <BarChart3 size={16} className="text-indigo-400" />
              <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500">Score Breakdown</h3>
            </div>

            <div className="space-y-4">
              {scoreBreakdown.map((item, i) => (
                <div key={i}>
                  <div className="mb-1.5 flex items-center justify-between text-sm">
                    <span className="text-slate-400">{item.label}</span>
                    <span className="font-semibold text-white">{item.value}%</span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-white/[0.06]">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${item.value}%` }}
                      transition={{ duration: 1, delay: 0.3 + i * 0.15, ease: [0.16, 1, 0.3, 1] as const }}
                      className={`h-full rounded-full bg-gradient-to-r ${item.color}`}
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-5 pt-4 border-t border-white/[0.06]">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-400">Overall Average</span>
                <span className="text-2xl font-bold text-white">{stats.avgScore}<span className="text-sm text-slate-500">/100</span></span>
              </div>
            </div>
          </motion.div>

          {/* Recent Sessions */}
          <motion.div {...fadeUp(0.2)} className="glass-card p-6 lg:col-span-2">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <Clock3 size={16} className="text-indigo-400" />
                <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500">Recent Sessions</h3>
              </div>
            </div>

            <div className="space-y-3">
              {recentSessions.map((session, i) => {
                const scoreColor =
                  session.score >= 80
                    ? "text-emerald-400 bg-emerald-500/10 border-emerald-400/20"
                    : session.score >= 65
                      ? "text-amber-400 bg-amber-500/10 border-amber-400/20"
                      : "text-red-400 bg-red-500/10 border-red-400/20";

                return (
                  <div key={i} className="flex items-center justify-between rounded-xl bg-white/[0.03] border border-white/[0.05] px-4 py-3 hover:bg-white/[0.05] transition-colors">
                    <div className="flex items-center gap-4">
                      <span className="text-xs text-slate-500 font-medium w-14">{session.date}</span>
                      <div>
                        <p className="text-sm font-medium text-slate-200">{session.part}</p>
                        <p className="text-xs text-slate-500">Level {session.level}</p>
                      </div>
                    </div>
                    <span className={`rounded-lg border px-3 py-1 text-sm font-bold ${scoreColor}`}>
                      {session.score}
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="mt-4 pt-4 border-t border-white/[0.06] text-center">
              <p className="text-sm text-slate-500">Session history will populate as you practice more.</p>
            </div>
          </motion.div>
        </div>

        {/* Buy More Sessions CTA */}
        <motion.div {...fadeUp(0.25)} className="mt-8 glass-card p-8 flex flex-col md:flex-row items-center justify-between gap-6 relative overflow-hidden">
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
      </div>
    </div>
  );
}
