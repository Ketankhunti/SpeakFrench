"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Mic, Lock, Eye, EyeOff, ArrowRight, AlertTriangle, Check, ShieldCheck } from "lucide-react";
import { supabase } from "@/lib/supabase";

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 24 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.5, delay, ease: [0.16, 1, 0.3, 1] as const } },
});

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [ready, setReady] = useState(false);

  // Supabase sends a PASSWORD_RECOVERY event when the user arrives via the reset link.
  // The URL hash contains access_token + type=recovery. We detect it multiple ways
  // because the event may fire before or after this listener mounts.
  useEffect(() => {
    if (!supabase) return;

    // 1. Check URL hash for recovery type (most reliable)
    const hash = window.location.hash;
    if (hash.includes("type=recovery")) {
      setReady(true);
    }

    // 2. Listen for the PASSWORD_RECOVERY event
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") {
        setReady(true);
      }
    });

    // 3. Check if already in a session (event already fired before mount)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setReady(true);
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) {
      setError("Supabase is not configured.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    setLoading(true);
    setError(null);

    const { error: updateError } = await supabase.auth.updateUser({
      password,
    });

    if (updateError) {
      setError(updateError.message);
      setLoading(false);
      return;
    }

    // Sign out so user must log in with the new password
    await supabase.auth.signOut();

    setSuccess(true);
    setLoading(false);

    // Redirect to sign-in page after a brief delay
    setTimeout(() => router.push("/auth"), 2000);
  };

  return (
    <div className="min-h-screen bg-[var(--background)] relative noise-overlay flex items-center justify-center px-6">
      {/* Background */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <div className="absolute top-[-20%] left-[-10%] w-[55%] h-[55%] rounded-full bg-indigo-600/15 blur-[150px]" />
        <div className="absolute bottom-[-15%] right-[-5%] w-[40%] h-[40%] rounded-full bg-violet-600/10 blur-[120px]" />
      </div>

      <div className="relative z-10 w-full max-w-md">
        {/* Logo */}
        <motion.div {...fadeUp(0)} className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-3 group">
            <div className="rounded-xl bg-gradient-to-tr from-indigo-500 to-violet-500 p-3 text-white shadow-lg shadow-indigo-500/25 transition-all duration-300 group-hover:shadow-indigo-500/40 group-hover:scale-105">
              <Mic size={24} />
            </div>
            <span className="text-3xl font-bold tracking-tight text-white">SpeakFrench</span>
          </Link>
          <p className="text-slate-400 mt-3 text-sm">Set your new password below.</p>
        </motion.div>

        {/* Card */}
        <motion.div {...fadeUp(0.1)} className="glass-card p-8">
          {success ? (
            <div className="text-center py-4">
              <div className="inline-flex rounded-2xl bg-emerald-500/15 p-4 text-emerald-400 mb-4">
                <ShieldCheck size={32} />
              </div>
              <h2 className="text-xl font-bold text-white mb-2">Password Updated!</h2>
              <p className="text-sm text-slate-400">Redirecting you to sign in...</p>
            </div>
          ) : !ready ? (
            <div className="text-center py-4">
              <p className="text-sm text-slate-400">Verifying your reset link...</p>
              <p className="text-xs text-slate-500 mt-2">
                If this takes too long, the link may have expired.{" "}
                <Link href="/auth" className="text-indigo-400 hover:text-indigo-300">Go back to login</Link>
              </p>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-6">
                <ShieldCheck size={18} className="text-indigo-400" />
                <h2 className="text-lg font-semibold text-white">Create New Password</h2>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                {/* New Password */}
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-400">New Password</label>
                  <div className="relative">
                    <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Min 6 characters"
                      required
                      minLength={6}
                      className="w-full rounded-xl border border-white/10 bg-white/[0.04] pl-10 pr-11 py-2.5 text-sm text-white outline-none transition-all focus:border-indigo-500/50 focus:ring-4 focus:ring-indigo-500/20 placeholder:text-slate-500"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                {/* Confirm Password */}
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-400">Confirm Password</label>
                  <div className="relative">
                    <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input
                      type={showConfirm ? "text" : "password"}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Re-enter your password"
                      required
                      minLength={6}
                      className="w-full rounded-xl border border-white/10 bg-white/[0.04] pl-10 pr-11 py-2.5 text-sm text-white outline-none transition-all focus:border-indigo-500/50 focus:ring-4 focus:ring-indigo-500/20 placeholder:text-slate-500"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirm(!showConfirm)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                    >
                      {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  {confirmPassword && password !== confirmPassword && (
                    <p className="mt-1 text-[11px] text-red-400">Passwords do not match</p>
                  )}
                </div>

                {/* Error */}
                {error && (
                  <div className="rounded-xl bg-red-500/10 border border-red-400/20 px-3 py-2 text-sm text-red-300 flex items-center gap-2">
                    <AlertTriangle size={14} />
                    {error}
                  </div>
                )}

                {/* Submit */}
                <button
                  type="submit"
                  disabled={loading || password !== confirmPassword}
                  className="w-full btn-primary rounded-xl py-3 text-sm font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? "Updating..." : (
                    <>
                      Update Password
                      <ArrowRight size={16} />
                    </>
                  )}
                </button>
              </form>
            </>
          )}
        </motion.div>

        <motion.p {...fadeUp(0.2)} className="text-center mt-6 text-xs text-slate-500">
          <Link href="/auth" className="text-indigo-400 hover:text-indigo-300">← Back to Sign In</Link>
        </motion.p>
      </div>
    </div>
  );
}
