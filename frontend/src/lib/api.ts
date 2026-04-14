const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// ── Payments ──

export async function fetchPacks() {
  const res = await fetch(`${API_URL}/api/payments/packs`);
  if (!res.ok) throw new Error("Failed to fetch packs");
  return res.json();
}

export async function createCheckout(
  packId: string,
  userId: string,
  successUrl: string,
  cancelUrl: string
) {
  const res = await fetch(`${API_URL}/api/payments/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pack_id: packId,
      user_id: userId,
      success_url: successUrl,
      cancel_url: cancelUrl,
    }),
  });
  if (!res.ok) throw new Error("Failed to create checkout");
  return res.json();
}

export async function fetchBalance(userId: string) {
  const res = await fetch(`${API_URL}/api/payments/balance/${userId}`);
  if (!res.ok) throw new Error("Failed to fetch balance");
  return res.json();
}

export async function fetchDemoStatus(userId: string) {
  const res = await fetch(`${API_URL}/api/session/demo-status/${userId}`);
  if (!res.ok) throw new Error("Failed to fetch demo status");
  return res.json();
}

// ── Profile ──

export async function fetchProfile(userId: string) {
  const res = await fetch(`${API_URL}/api/profile/${userId}`);
  if (!res.ok) throw new Error("Failed to fetch profile");
  return res.json();
}

export async function updateProfile(
  userId: string,
  data: { full_name?: string; email?: string; avatar_url?: string }
) {
  const res = await fetch(`${API_URL}/api/profile/${userId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to update profile");
  return res.json();
}

export async function uploadAvatar(userId: string, file: File) {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${API_URL}/api/profile/${userId}/avatar`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) throw new Error("Failed to upload avatar");
  return res.json();
}

export async function deleteAccount(userId: string) {
  const res = await fetch(`${API_URL}/api/profile/${userId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete account");
  return res.json();
}

// ── Dashboard ──

export async function fetchDashboard(userId: string) {
  const res = await fetch(`${API_URL}/api/dashboard/${userId}`);
  if (!res.ok) throw new Error("Failed to fetch dashboard");
  return res.json();
}

export async function regenerateReview(userId: string, sessionId: string) {
  const res = await fetch(
    `${API_URL}/api/dashboard/${userId}/session/${sessionId}/regenerate-review`,
    { method: "POST" }
  );
  if (!res.ok) throw new Error("Failed to regenerate review");
  return res.json();
}
