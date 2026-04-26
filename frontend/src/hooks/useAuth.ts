import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

export function useAuth(requireAuth = true) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    let mounted = true;

    // Read the cached session synchronously from local storage.
    // This avoids the auth-token web lock contention that getUser()
    // can trigger when multiple components mount in parallel
    // (React Strict Mode double-invoke + onAuthStateChange listener).
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return;
      const currentUser = session?.user ?? null;
      if (!currentUser && requireAuth) {
        router.replace("/auth");
        return;
      }
      setUser(currentUser);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;

      // TOKEN_REFRESHED fires every time the tab regains focus and Supabase
      // silently rotates the access token. The user is unchanged, so we
      // ignore it to avoid pointless re-renders / redirect flashes.
      if (event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
        return;
      }

      const nextUser = session?.user ?? null;

      // Avoid re-render storm when the user reference is logically the same.
      setUser((prev) => (prev?.id === nextUser?.id ? prev : nextUser));

      if (!nextUser && requireAuth) {
        router.replace("/auth");
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [requireAuth, router]);

  return { user, loading };
}
