"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Mic,
  Shield,
  RefreshCw,
  Activity,
  AlertTriangle,
  Clock3,
  Zap,
  ArrowLeft,
  Lock,
  Timer,
  Server,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { checkAdmin, fetchMetrics, resetMetrics } from "@/lib/api";

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 24 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.5, delay, ease: [0.16, 1, 0.3, 1] as const } },
});

interface Metrics {
  lock_acquire_failed: number;
  lock_heartbeat_failed: number;
  session_start_throttled: number;
  dependency_timeout_stt: number;
  dependency_timeout_eval: number;
  dependency_timeout_llm: number;
  dependency_timeout_tts: number;
  dependency_timeout_review: number;
  dependency_timeout_total: number;
  sessions_started: number;
  sessions_completed: number;
  sessions_errored: number;
  active_sessions: number;
  uptime_seconds: number;
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export default function AdminPage() {
  const { user, loading: authLoading } = useAuth();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loadingMetrics, setLoadingMetrics] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const email = user?.email ?? "";

  // Check admin status
  useEffect(() => {
    if (!email) return;
    checkAdmin(email).then((r) => setIsAdmin(r.is_admin)).catch(() => setIsAdmin(false));
  }, [email]);

  // Fetch metrics
  const loadMetrics = useCallback(async () => {
    if (!email) return;
    setLoadingMetrics(true);
    setError(null);
    try {
      const data = await fetchMetrics(email);
      setMetrics(data);
    } catch (e) {
      setError("Failed to load metrics");
    }
    setLoadingMetrics(false);
  }, [email]);

  useEffect(() => {
    if (isAdmin) void loadMetrics();
  }, [isAdmin, loadMetrics]);

  // Auto-refresh every 5s
  useEffect(() => {
    if (!autoRefresh || !isAdmin) return;
    const interval = setInterval(loadMetrics, 5000);
    return () => clearInterval(interval);
  }, [autoRefresh, isAdmin, loadMetrics]);

  const handleReset = async () => {
    if (!email) return;
    setResetting(true);
    try {
      await resetMetrics(email);
      await loadMetrics();
    } catch {
      setError("Failed to reset metrics");
    }
    setResetting(false);
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[var(--background)] flex items-center justify-center">
        <div className="text-slate-400 text-sm">Loading...</div>
      </div>
    );
  }

  if (isAdmin === false) {
    return (
      <div className="min-h-screen bg-[var(--background)] flex items-center justify-center">
        <div className="glass-card p-10 text-center max-w-md">
          <Lock className="mx-auto mb-4 text-red-400" size={48} />
          <h2 className="text-xl font-bold text-white mb-2">Access Denied</h2>
          <p className="text-slate-400 mb-6">You don&apos;t have admin access to this page.</p>
          <Link href="/dashboard" className="btn-primary px-6 py-2.5 text-sm inline-flex items-center gap-2">
            <ArrowLeft size={14} /> Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  if (isAdmin === null) {
    return (
      <div className="min-h-screen bg-[var(--background)] flex items-center justify-center">
        <div className="text-slate-400 text-sm">Checking access...</div>
      </div>
    );
  }

  const errorRate = metrics
    ? metrics.sessions_started > 0
      ? ((metrics.sessions_errored / metrics.sessions_started) * 100).toFixed(1)
      : "0.0"
    : "—";

  const completionRate = metrics
    ? metrics.sessions_started > 0
      ? ((metrics.sessions_completed / metrics.sessions_started) * 100).toFixed(1)
      : "0.0"
    : "—";

  return (
    <div className="min-h-screen bg-[var(--background)] relative noise-overlay">
      {/* Background */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <div className="absolute top-[-20%] left-[-10%] w-[55%] h-[55%] rounded-full bg-red-600/10 blur-[150px]" />
        <div className="absolute bottom-[-15%] right-[-5%] w-[40%] h-[40%] rounded-full bg-orange-600/8 blur-[120px]" />
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
            <Link href="/dashboard" className="hover:text-white transition-colors duration-200 flex items-center gap-1.5">
              <ArrowLeft size={14} /> Dashboard
            </Link>
          </nav>
        </div>
      </header>

      <div className="relative z-10 mx-auto max-w-7xl px-6 py-10">
        {/* Title */}
        <motion.div {...fadeUp(0)} className="mb-8 flex items-center gap-4">
          <div className="rounded-2xl bg-gradient-to-br from-red-500 to-orange-500 p-3 text-white shadow-lg shadow-red-500/25">
            <Shield size={24} />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-white">Admin Panel</h1>
            <p className="text-slate-400 text-sm">Real-time operational metrics &amp; system health</p>
          </div>
        </motion.div>

        {/* Controls */}
        <motion.div {...fadeUp(0.05)} className="flex items-center gap-3 mb-8">
          <button
            onClick={loadMetrics}
            disabled={loadingMetrics}
            className="btn-primary px-4 py-2.5 text-sm inline-flex items-center gap-2"
          >
            <RefreshCw size={14} className={loadingMetrics ? "animate-spin" : ""} />
            Refresh
          </button>
          <button
            onClick={handleReset}
            disabled={resetting}
            className="px-4 py-2.5 text-sm rounded-xl border border-white/10 text-slate-300 hover:bg-white/5 transition-colors inline-flex items-center gap-2"
          >
            <Timer size={14} />
            {resetting ? "Resetting..." : "Reset Counters"}
          </button>
          <label className="flex items-center gap-2 text-sm text-slate-400 ml-auto cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded border-white/20 bg-white/5 text-indigo-500 focus:ring-indigo-500/30"
            />
            Auto-refresh (5s)
          </label>
        </motion.div>

        {error && (
          <div className="mb-6 rounded-xl bg-red-500/10 border border-red-400/20 p-4 text-sm text-red-300">
            {error}
          </div>
        )}

        {metrics && (
          <>
            {/* Top-level KPIs */}
            <motion.div {...fadeUp(0.1)} className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
              {[
                { label: "Uptime", value: formatUptime(metrics.uptime_seconds), icon: Server, color: "from-emerald-500 to-teal-400" },
                { label: "Active Now", value: metrics.active_sessions.toString(), icon: Zap, color: metrics.active_sessions > 0 ? "from-blue-500 to-cyan-400" : "from-slate-500 to-slate-600" },
                { label: "Error Rate", value: `${errorRate}%`, icon: AlertTriangle, color: Number(errorRate) > 5 ? "from-red-500 to-orange-400" : "from-emerald-500 to-teal-400" },
                { label: "Completion Rate", value: `${completionRate}%`, icon: Activity, color: "from-violet-500 to-purple-400" },
              ].map((kpi) => (
                <div key={kpi.label} className="glass-card p-5">
                  <div className="flex items-center gap-3 mb-3">
                    <div className={`rounded-xl bg-gradient-to-br ${kpi.color} p-2 text-white`}>
                      <kpi.icon size={16} />
                    </div>
                    <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">{kpi.label}</span>
                  </div>
                  <div className="text-2xl font-bold text-white">{kpi.value}</div>
                </div>
              ))}
            </motion.div>

            {/* Session Lifecycle */}
            <motion.div {...fadeUp(0.15)} className="grid md:grid-cols-3 gap-4 mb-8">
              <div className="glass-card p-5">
                <h3 className="text-sm font-medium text-slate-400 mb-4 flex items-center gap-2">
                  <Zap size={14} className="text-blue-400" /> Session Lifecycle
                  <span className="ml-auto text-[10px] font-normal text-slate-500">cumulative</span>
                </h3>
                <div className="space-y-3">
                  {[
                    { label: "Total Started", value: metrics.sessions_started, color: "bg-blue-500" },
                    { label: "Completed", value: metrics.sessions_completed, color: "bg-emerald-500" },
                    { label: "Errored", value: metrics.sessions_errored, color: "bg-red-500" },
                    { label: "Active Now", value: metrics.active_sessions, color: "bg-amber-500" },
                  ].map((item) => (
                    <div key={item.label} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${item.color}`} />
                        <span className="text-sm text-slate-300">{item.label}</span>
                      </div>
                      <span className="text-sm font-semibold text-white">{item.value}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Lock & Throttle */}
              <div className="glass-card p-5">
                <h3 className="text-sm font-medium text-slate-400 mb-4 flex items-center gap-2">
                  <Lock size={14} className="text-amber-400" /> Lock &amp; Throttle
                </h3>
                <div className="space-y-3">
                  {[
                    { label: "Lock Acquire Failed", value: metrics.lock_acquire_failed, warn: 5 },
                    { label: "Heartbeat Failed", value: metrics.lock_heartbeat_failed, warn: 1 },
                    { label: "Start Throttled", value: metrics.session_start_throttled, warn: 10 },
                  ].map((item) => (
                    <div key={item.label} className="flex items-center justify-between">
                      <span className="text-sm text-slate-300">{item.label}</span>
                      <span className={`text-sm font-semibold ${item.value >= item.warn ? "text-amber-400" : "text-white"}`}>
                        {item.value}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Dependency Timeouts */}
              <div className="glass-card p-5">
                <h3 className="text-sm font-medium text-slate-400 mb-4 flex items-center gap-2">
                  <Clock3 size={14} className="text-red-400" /> Dependency Timeouts
                </h3>
                <div className="space-y-3">
                  {[
                    { label: "STT", value: metrics.dependency_timeout_stt },
                    { label: "Eval", value: metrics.dependency_timeout_eval },
                    { label: "LLM", value: metrics.dependency_timeout_llm },
                    { label: "TTS", value: metrics.dependency_timeout_tts },
                    { label: "Review", value: metrics.dependency_timeout_review },
                  ].map((item) => (
                    <div key={item.label} className="flex items-center justify-between">
                      <span className="text-sm text-slate-300">{item.label}</span>
                      <span className={`text-sm font-semibold ${item.value > 0 ? "text-red-400" : "text-white"}`}>
                        {item.value}
                      </span>
                    </div>
                  ))}
                  <div className="border-t border-white/[0.06] pt-2 flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-300">Total</span>
                    <span className={`text-sm font-bold ${metrics.dependency_timeout_total > 0 ? "text-red-400" : "text-white"}`}>
                      {metrics.dependency_timeout_total}
                    </span>
                  </div>
                </div>
              </div>
            </motion.div>

            {/* Architecture info */}
            <motion.div {...fadeUp(0.2)} className="glass-card p-6">
              <h3 className="text-sm font-medium text-slate-400 mb-4">Architecture Safeguards</h3>
              <div className="grid md:grid-cols-2 gap-4 text-sm text-slate-300">
                <div className="space-y-2">
                  <div className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Redis NX distributed session locks with owner tokens</div>
                  <div className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Lock heartbeat refreshes TTL every 15s</div>
                  <div className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Compare-and-delete unlock prevents cross-session release</div>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-blue-500" /> Per-step timeouts: STT 20s, LLM 18s, TTS 15s, Eval 12s</div>
                  <div className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-blue-500" /> Bounded concurrency semaphores per dependency</div>
                  <div className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-blue-500" /> Graceful fallback: text-only when TTS fails</div>
                </div>
              </div>
            </motion.div>
          </>
        )}

        {!metrics && !loadingMetrics && !error && (
          <div className="flex items-center justify-center py-20">
            <div className="text-slate-400 text-sm">Loading metrics...</div>
          </div>
        )}
      </div>
    </div>
  );
}
