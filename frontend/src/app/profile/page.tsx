"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Mic,
  Play,
  User,
  Mail,
  Calendar,
  CreditCard,
  Package,
  Shield,
  LogOut,
  Trash2,
  KeyRound,
  Save,
  Check,
  AlertTriangle,
  ChevronRight,
  Target,
} from "lucide-react";
import { supabase } from "@/lib/supabase";

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 24 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.5, delay, ease: [0.16, 1, 0.3, 1] as const } },
});

type ProfileState = {
  fullName: string;
  email: string;
};

type AccountInfo = {
  memberSince: string;
  currentPack: string;
  sessionsRemaining: number;
  sessionsTotal: number;
  totalSessionsCompleted: number;
};

export default function ProfilePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<ProfileState>({ fullName: "", email: "" });
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [passwordStatus, setPasswordStatus] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteText, setDeleteText] = useState("");

  // TODO: Replace with real data from Supabase
  const [account] = useState<AccountInfo>({
    memberSince: "March 15, 2026",
    currentPack: "Focus (5 sessions)",
    sessionsRemaining: 8,
    sessionsTotal: 15,
    totalSessionsCompleted: 12,
  });

  useEffect(() => {
    const loadProfile = async () => {
      setLoading(true);
      setError(null);

      if (!supabase) {
        setError("Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.");
        setLoading(false);
        return;
      }

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        setError("Please sign in to manage your profile.");
        setLoading(false);
        return;
      }

      setUserId(user.id);

      const fallbackFullName =
        typeof user.user_metadata?.full_name === "string"
          ? user.user_metadata.full_name
          : "";
      const fallbackEmail = user.email ?? "";

      const { data: existingProfile, error: fetchError } = await supabase
        .from("profiles")
        .select("full_name, email")
        .eq("user_id", user.id)
        .maybeSingle();

      if (fetchError) {
        setError("Could not load profile.");
        setLoading(false);
        return;
      }

      const fullName = existingProfile?.full_name ?? fallbackFullName;
      const email = existingProfile?.email ?? fallbackEmail;

      setProfile({ fullName, email });

      if (!existingProfile) {
        await supabase.from("profiles").upsert(
          {
            user_id: user.id,
            full_name: fullName,
            email,
          },
          { onConflict: "user_id" }
        );
      }

      setLoading(false);
    };

    void loadProfile();
  }, []);

  const handleSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!userId) return;
    if (!supabase) {
      setError("Supabase is not configured.");
      return;
    }

    setSaving(true);
    setStatus(null);
    setError(null);

    const cleanName = profile.fullName.trim();
    const cleanEmail = profile.email.trim();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setError("Your session expired. Please sign in again.");
      setSaving(false);
      return;
    }

    if (cleanEmail && user.email && cleanEmail !== user.email) {
      const { error: emailUpdateError } = await supabase.auth.updateUser({
        email: cleanEmail,
      });

      if (emailUpdateError) {
        setError(emailUpdateError.message);
        setSaving(false);
        return;
      }

      setStatus("Verification email sent to your new address.");
    }

    const { error: metadataUpdateError } = await supabase.auth.updateUser({
      data: { full_name: cleanName },
    });

    if (metadataUpdateError) {
      setError(metadataUpdateError.message);
      setSaving(false);
      return;
    }

    const { error: profileUpdateError } = await supabase.from("profiles").upsert(
      {
        user_id: userId,
        full_name: cleanName,
        email: cleanEmail || user.email || "",
      },
      { onConflict: "user_id" }
    );

    if (profileUpdateError) {
      setError(profileUpdateError.message);
      setSaving(false);
      return;
    }

    setStatus((prev) => prev ?? "Profile updated successfully.");
    setSaving(false);
  };

  const handlePasswordReset = async () => {
    if (!supabase || !profile.email) return;
    setPasswordStatus(null);

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(profile.email, {
      redirectTo: `${window.location.origin}/profile`,
    });

    if (resetError) {
      setPasswordStatus(`Error: ${resetError.message}`);
    } else {
      setPasswordStatus("Password reset email sent. Check your inbox.");
    }
  };

  const handleSignOut = async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    router.push("/");
  };

  const handleDeleteAccount = async () => {
    if (deleteText !== "DELETE" || !supabase || !userId) return;
    // NOTE: Full account deletion requires a backend endpoint with service_role key
    // For now, sign out and show message
    await supabase.auth.signOut();
    router.push("/");
  };

  // Initials for avatar
  const initials = profile.fullName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2) || "?";

  const sessionsUsedPercent = account.sessionsTotal > 0
    ? Math.round(((account.sessionsTotal - account.sessionsRemaining) / account.sessionsTotal) * 100)
    : 0;

  return (
    <div className="min-h-screen bg-[var(--background)] relative noise-overlay">
      {/* Background Orbs */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-indigo-600/15 blur-[150px]" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[40%] h-[40%] rounded-full bg-violet-600/10 blur-[120px]" />
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
            <Link href="/dashboard" className="hover:text-white transition-colors duration-200">Dashboard</Link>
            <Link href="/pricing" className="hover:text-white transition-colors duration-200">Pricing</Link>
            <Link href="/profile" className="text-white transition-colors duration-200 flex items-center gap-1.5">
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

      <div className="relative z-10 mx-auto max-w-4xl px-6 py-10">
        {/* Profile Header with Avatar */}
        <motion.div {...fadeUp(0)} className="flex items-center gap-6 mb-8">
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center text-white text-2xl font-bold shadow-lg shadow-indigo-500/25 shrink-0">
            {loading ? "..." : initials}
          </div>
          <div>
            <h1 className="text-3xl font-bold text-white">{loading ? "Loading..." : profile.fullName || "Your Profile"}</h1>
            <p className="text-slate-400 mt-1">{loading ? "" : profile.email}</p>
            <p className="text-xs text-slate-500 mt-0.5">Member since {account.memberSince}</p>
          </div>
        </motion.div>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Left Column: Account Overview */}
          <div className="lg:col-span-1 space-y-6">
            {/* Account Stats */}
            <motion.div {...fadeUp(0.05)} className="glass-card p-5">
              <div className="flex items-center gap-2 mb-4">
                <Package size={14} className="text-indigo-400" />
                <h3 className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Account Overview</h3>
              </div>

              <div className="space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] text-slate-400">Current Pack</span>
                    <span className="text-xs font-semibold text-indigo-300">{account.currentPack}</span>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[11px] text-slate-400">Sessions Remaining</span>
                    <span className="text-xs font-semibold text-white">{account.sessionsRemaining} / {account.sessionsTotal}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-400 transition-all duration-500"
                      style={{ width: `${100 - sessionsUsedPercent}%` }}
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-slate-400">Sessions Completed</span>
                  <span className="text-xs font-semibold text-white">{account.totalSessionsCompleted}</span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-slate-400">Member Since</span>
                  <span className="text-xs text-slate-300">{account.memberSince}</span>
                </div>
              </div>

              <Link
                href="/pricing"
                className="mt-4 flex items-center justify-center gap-2 rounded-xl bg-white/[0.04] border border-white/[0.08] px-4 py-2.5 text-xs font-medium text-slate-300 hover:bg-white/[0.08] hover:border-indigo-400/30 transition-all"
              >
                <CreditCard size={14} />
                Buy More Sessions
                <ChevronRight size={12} />
              </Link>
            </motion.div>

            {/* Quick Stats */}
            <motion.div {...fadeUp(0.1)} className="grid grid-cols-2 gap-3">
              <div className="glass-card p-3.5 text-center">
                <div className="inline-flex rounded-lg bg-gradient-to-br from-emerald-500 to-teal-400 p-1.5 text-white mb-2">
                  <Target size={14} />
                </div>
                <p className="text-lg font-bold text-white">{account.totalSessionsCompleted}</p>
                <p className="text-[10px] text-slate-500">Total Sessions</p>
              </div>
              <div className="glass-card p-3.5 text-center">
                <div className="inline-flex rounded-lg bg-gradient-to-br from-indigo-500 to-violet-400 p-1.5 text-white mb-2">
                  <Calendar size={14} />
                </div>
                <p className="text-lg font-bold text-white">{account.sessionsRemaining}</p>
                <p className="text-[10px] text-slate-500">Remaining</p>
              </div>
            </motion.div>
          </div>

          {/* Right Column: Forms */}
          <div className="lg:col-span-2 space-y-6">
            {/* Personal Information */}
            <motion.div {...fadeUp(0.1)} className="glass-card p-6">
              <div className="flex items-center gap-2 mb-5">
                <User size={14} className="text-indigo-400" />
                <h3 className="text-sm font-semibold text-white">Personal Information</h3>
              </div>

              {loading ? (
                <p className="text-slate-400">Loading profile...</p>
              ) : (
                <form onSubmit={handleSave} className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label htmlFor="fullName" className="mb-1.5 block text-xs font-medium text-slate-400">
                        Full Name
                      </label>
                      <input
                        id="fullName"
                        type="text"
                        value={profile.fullName}
                        onChange={(e) => setProfile((p) => ({ ...p, fullName: e.target.value }))}
                        placeholder="Enter your full name"
                        className="w-full rounded-xl border border-white/10 bg-white/[0.04] backdrop-blur-sm px-4 py-2.5 text-sm text-white outline-none transition-all focus:border-indigo-500/50 focus:ring-4 focus:ring-indigo-500/20 placeholder:text-slate-500"
                      />
                    </div>

                    <div>
                      <label htmlFor="email" className="mb-1.5 block text-xs font-medium text-slate-400">
                        Email Address
                      </label>
                      <input
                        id="email"
                        type="email"
                        value={profile.email}
                        onChange={(e) => setProfile((p) => ({ ...p, email: e.target.value }))}
                        placeholder="Enter your email"
                        className="w-full rounded-xl border border-white/10 bg-white/[0.04] backdrop-blur-sm px-4 py-2.5 text-sm text-white outline-none transition-all focus:border-indigo-500/50 focus:ring-4 focus:ring-indigo-500/20 placeholder:text-slate-500"
                      />
                      <p className="mt-1 text-[10px] text-slate-500">
                        Changing email requires verification.
                      </p>
                    </div>
                  </div>

                  {error && (
                    <div className="rounded-xl bg-red-500/10 border border-red-400/20 px-3 py-2 text-sm text-red-300 flex items-center gap-2">
                      <AlertTriangle size={14} />
                      {error}
                    </div>
                  )}

                  {status && (
                    <div className="rounded-xl bg-emerald-500/10 border border-emerald-400/20 px-3 py-2 text-sm text-emerald-300 flex items-center gap-2">
                      <Check size={14} />
                      {status}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={saving || loading}
                    className="btn-primary rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Save size={14} />
                    {saving ? "Saving..." : "Save Changes"}
                  </button>
                </form>
              )}
            </motion.div>

            {/* Security */}
            <motion.div {...fadeUp(0.15)} className="glass-card p-6">
              <div className="flex items-center gap-2 mb-5">
                <Shield size={14} className="text-indigo-400" />
                <h3 className="text-sm font-semibold text-white">Security</h3>
              </div>

              <div className="space-y-4">
                {/* Password Reset */}
                <div className="flex items-center justify-between rounded-xl bg-white/[0.03] border border-white/[0.05] px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="rounded-lg bg-amber-500/15 p-2 text-amber-400">
                      <KeyRound size={16} />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-200">Change Password</p>
                      <p className="text-[11px] text-slate-500">Receive a password reset link via email.</p>
                    </div>
                  </div>
                  <button
                    onClick={handlePasswordReset}
                    disabled={!profile.email}
                    className="text-xs font-medium text-indigo-400 hover:text-indigo-300 transition-colors px-3 py-1.5 rounded-lg hover:bg-white/[0.04] disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Send Reset Link
                  </button>
                </div>

                {passwordStatus && (
                  <div className={`rounded-xl px-3 py-2 text-sm flex items-center gap-2 ${
                    passwordStatus.startsWith("Error")
                      ? "bg-red-500/10 border border-red-400/20 text-red-300"
                      : "bg-emerald-500/10 border border-emerald-400/20 text-emerald-300"
                  }`}>
                    {passwordStatus.startsWith("Error") ? <AlertTriangle size={14} /> : <Check size={14} />}
                    {passwordStatus}
                  </div>
                )}

                {/* Sign Out */}
                <div className="flex items-center justify-between rounded-xl bg-white/[0.03] border border-white/[0.05] px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="rounded-lg bg-slate-500/15 p-2 text-slate-400">
                      <LogOut size={16} />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-200">Sign Out</p>
                      <p className="text-[11px] text-slate-500">Sign out of your account on this device.</p>
                    </div>
                  </div>
                  <button
                    onClick={handleSignOut}
                    className="text-xs font-medium text-slate-400 hover:text-white transition-colors px-3 py-1.5 rounded-lg hover:bg-white/[0.04]"
                  >
                    Sign Out
                  </button>
                </div>
              </div>
            </motion.div>

            {/* Danger Zone */}
            <motion.div {...fadeUp(0.2)} className="glass-card p-6 border-red-500/10">
              <div className="flex items-center gap-2 mb-5">
                <AlertTriangle size={14} className="text-red-400" />
                <h3 className="text-sm font-semibold text-red-400">Danger Zone</h3>
              </div>

              <div className="rounded-xl bg-red-500/5 border border-red-400/10 px-4 py-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="rounded-lg bg-red-500/15 p-2 text-red-400">
                      <Trash2 size={16} />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-200">Delete Account</p>
                      <p className="text-[11px] text-slate-500">Permanently delete your account and all data. This cannot be undone.</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setShowDeleteConfirm(!showDeleteConfirm)}
                    className="text-xs font-medium text-red-400 hover:text-red-300 transition-colors px-3 py-1.5 rounded-lg hover:bg-red-500/10"
                  >
                    {showDeleteConfirm ? "Cancel" : "Delete"}
                  </button>
                </div>

                {showDeleteConfirm && (
                  <div className="mt-4 pt-4 border-t border-red-400/10">
                    <p className="text-xs text-slate-400 mb-2">
                      Type <span className="font-bold text-red-400">DELETE</span> to confirm account deletion.
                    </p>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={deleteText}
                        onChange={(e) => setDeleteText(e.target.value)}
                        placeholder="Type DELETE"
                        className="flex-1 rounded-lg border border-red-400/20 bg-red-500/5 px-3 py-2 text-sm text-white outline-none focus:border-red-400/40 placeholder:text-slate-600"
                      />
                      <button
                        onClick={handleDeleteAccount}
                        disabled={deleteText !== "DELETE"}
                        className="rounded-lg bg-red-500/20 border border-red-400/20 px-4 py-2 text-xs font-semibold text-red-400 hover:bg-red-500/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        Confirm Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        </div>
      </div>
    </div>
  );
}
