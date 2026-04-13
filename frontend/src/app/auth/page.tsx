"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Mic, Mail, Lock, User, Eye, EyeOff, ArrowRight, AlertTriangle, Check } from "lucide-react";
import { supabase } from "@/lib/supabase";

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 24 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.5, delay, ease: [0.16, 1, 0.3, 1] as const } },
});

type Mode = "login" | "signup";

export default function AuthPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) {
      setError("Supabase is not configured.");
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    if (mode === "signup" && password !== confirmPassword) {
      setError("Passwords do not match.");
      setLoading(false);
      return;
    }

    if (mode === "signup") {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName },
          emailRedirectTo: `${window.location.origin}/auth`,
        },
      });

      if (signUpError) {
        setError(signUpError.message);
        setLoading(false);
        return;
      }

      // Initialize profile in profiles table
      if (data.user) {
        await supabase.from("profiles").upsert(
          {
            user_id: data.user.id,
            full_name: fullName,
            email,
          },
          { onConflict: "user_id" }
        );
      }

      // Check if email confirmation is required
      if (data.user && !data.session) {
        setSuccess("If this email isn't already registered, you'll receive a confirmation link. Check your inbox (and spam folder).");
        setLoading(false);
        return;
      }

      // Auto-confirmed → redirect
      router.push("/dashboard");
    } else {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) {
        setError(signInError.message);
        setLoading(false);
        return;
      }

      router.push("/dashboard");
    }

    setLoading(false);
  };

  const handleForgotPassword = async () => {
    if (!supabase) {
      setError("Supabase is not configured.");
      return;
    }
    if (!email) {
      setError("Enter your email address first, then click Forgot password.");
      return;
    }
    setError(null);
    setSuccess(null);

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/reset-password`,
    });

    if (resetError) {
      setError(resetError.message);
    } else {
      setSuccess("If this email is registered, you'll receive a password reset link.");
    }
  };

  const handleGoogleSignIn = async () => {
    if (!supabase) {
      setError("Supabase is not configured.");
      return;
    }

    const { error: googleError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/dashboard`,
      },
    });

    if (googleError) {
      setError(googleError.message);
    }
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
          <p className="text-slate-400 mt-3 text-sm">
            {mode === "login" ? "Welcome back! Sign in to continue practicing." : "Create your account and start practicing French."}
          </p>
        </motion.div>

        {/* Auth Card */}
        <motion.div {...fadeUp(0.1)} className="glass-card p-8">
          {/* Mode Toggle */}
          <div className="flex rounded-xl bg-white/[0.04] p-1 mb-6">
            <button
              onClick={() => { setMode("login"); setError(null); setSuccess(null); }}
              className={`flex-1 rounded-lg py-2 text-sm font-medium transition-all ${
                mode === "login"
                  ? "bg-indigo-500/20 text-white shadow-sm"
                  : "text-slate-400 hover:text-slate-300"
              }`}
            >
              Sign In
            </button>
            <button
              onClick={() => { setMode("signup"); setError(null); setSuccess(null); }}
              className={`flex-1 rounded-lg py-2 text-sm font-medium transition-all ${
                mode === "signup"
                  ? "bg-indigo-500/20 text-white shadow-sm"
                  : "text-slate-400 hover:text-slate-300"
              }`}
            >
              Sign Up
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Name — signup only */}
            {mode === "signup" && (
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-400">Full Name</label>
                <div className="relative">
                  <User size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Enter your full name"
                    required
                    className="w-full rounded-xl border border-white/10 bg-white/[0.04] pl-10 pr-4 py-2.5 text-sm text-white outline-none transition-all focus:border-indigo-500/50 focus:ring-4 focus:ring-indigo-500/20 placeholder:text-slate-500"
                  />
                </div>
              </div>
            )}

            {/* Email */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-400">Email Address</label>
              <div className="relative">
                <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  className="w-full rounded-xl border border-white/10 bg-white/[0.04] pl-10 pr-4 py-2.5 text-sm text-white outline-none transition-all focus:border-indigo-500/50 focus:ring-4 focus:ring-indigo-500/20 placeholder:text-slate-500"
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-400">Password</label>
              <div className="relative">
                <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === "signup" ? "Min 6 characters" : "Enter your password"}
                  required
                  minLength={mode === "signup" ? 6 : undefined}
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
              {mode === "login" && (
                <button
                  type="button"
                  onClick={handleForgotPassword}
                  className="mt-1.5 block text-[11px] text-indigo-400 hover:text-indigo-300 transition-colors"
                >
                  Forgot password?
                </button>
              )}
            </div>

            {/* Confirm Password — signup only */}
            {mode === "signup" && (
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
            )}

            {/* Error */}
            {error && (
              <div className="rounded-xl bg-red-500/10 border border-red-400/20 px-3 py-2 text-sm text-red-300 flex items-center gap-2">
                <AlertTriangle size={14} />
                {error}
              </div>
            )}

            {/* Success */}
            {success && (
              <div className="rounded-xl bg-emerald-500/10 border border-emerald-400/20 px-3 py-2 text-sm text-emerald-300 flex items-center gap-2">
                <Check size={14} />
                {success}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full btn-primary rounded-xl py-3 text-sm font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                "Processing..."
              ) : (
                <>
                  {mode === "login" ? "Sign In" : "Create Account"}
                  <ArrowRight size={16} />
                </>
              )}
            </button>
          </form>

          {/* Divider */}
          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-white/[0.06]" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-[var(--glass-bg)] px-3 text-slate-500">or continue with</span>
            </div>
          </div>

          {/* Google */}
          <button
            onClick={handleGoogleSignIn}
            className="w-full rounded-xl border border-white/[0.08] bg-white/[0.04] py-2.5 text-sm font-medium text-slate-300 hover:bg-white/[0.08] hover:border-white/[0.15] transition-all flex items-center justify-center gap-3"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            Continue with Google
          </button>
        </motion.div>

        {/* Footer */}
        <motion.p {...fadeUp(0.2)} className="text-center mt-6 text-xs text-slate-500">
          By continuing, you agree to our Terms of Service and Privacy Policy.
        </motion.p>
      </div>
    </div>
  );
}
