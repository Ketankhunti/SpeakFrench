const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

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
