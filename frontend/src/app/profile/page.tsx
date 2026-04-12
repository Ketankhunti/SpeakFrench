"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type ProfileState = {
  fullName: string;
  email: string;
};

export default function ProfilePage() {
  const [profile, setProfile] = useState<ProfileState>({ fullName: "", email: "" });
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="min-h-screen bg-[var(--background)] relative px-6 py-12 noise-overlay">
      {/* Background Orbs */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-indigo-600/15 blur-[150px]" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[40%] h-[40%] rounded-full bg-violet-600/10 blur-[120px]" />
      </div>

      <div className="relative z-10 mx-auto max-w-3xl">
        <Link href="/" className="text-sm text-indigo-400 hover:text-indigo-300 transition-colors">
          &larr; Back to home
        </Link>

        <h1 className="font-display mt-6 text-4xl text-white">Your Profile</h1>
        <p className="mt-2 text-slate-400">
          Keep your name and email updated for billing and session records.
        </p>

        <div className="glass-card mt-8 p-10">
          {loading ? (
            <p className="text-slate-400">Loading profile...</p>
          ) : (
            <form onSubmit={handleSave} className="space-y-5">
              <div>
                <label htmlFor="fullName" className="mb-1 block text-sm font-medium text-slate-300">
                  Full name
                </label>
                <input
                  id="fullName"
                  type="text"
                  value={profile.fullName}
                  onChange={(e) => setProfile((p) => ({ ...p, fullName: e.target.value }))}
                  placeholder="Enter your full name"
                  className="w-full rounded-xl border border-white/10 bg-white/[0.04] backdrop-blur-sm px-4 py-2.5 text-white outline-none transition-all focus:border-indigo-500/50 focus:ring-4 focus:ring-indigo-500/20 placeholder:text-slate-500 glow-ring"
                />
              </div>

              <div>
                <label htmlFor="email" className="mb-1 block text-sm font-medium text-slate-300">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  value={profile.email}
                  onChange={(e) => setProfile((p) => ({ ...p, email: e.target.value }))}
                  placeholder="Enter your email"
                  className="w-full rounded-xl border border-white/10 bg-white/[0.04] backdrop-blur-sm px-4 py-2.5 text-white outline-none transition-all focus:border-indigo-500/50 focus:ring-4 focus:ring-indigo-500/20 placeholder:text-slate-500 glow-ring"
                />
                <p className="mt-1 text-xs text-slate-500">
                  Changing email may require verification by Supabase Auth.
                </p>
              </div>

              {error && (
                <div className="rounded-xl bg-red-500/10 border border-red-400/20 px-3 py-2 text-sm text-red-300">
                  {error}
                </div>
              )}

              {status && (
                <div className="rounded-xl bg-emerald-500/10 border border-emerald-400/20 px-3 py-2 text-sm text-emerald-300">
                  {status}
                </div>
              )}

              <button
                type="submit"
                disabled={saving || loading}
                className="btn-primary rounded-xl px-6 py-2.5 font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save Profile"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
