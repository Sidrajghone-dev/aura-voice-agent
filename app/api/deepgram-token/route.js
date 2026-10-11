export async function POST() {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) {
    return Response.json({ error: "DEEPGRAM_API_KEY is missing in .env.local" }, { status: 500 });
  }

  // Try a short-lived token first.
  const res = await fetch("https://api.deepgram.com/v1/auth/grant", {
    method: "POST",
    headers: {
      Authorization: `Token ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ttl_seconds: 300 }),
  });

  if (res.ok) {
    const data = await res.json();
    return Response.json({ token: data.access_token });
  }

  // Fallback: return the key itself (testing only).
  console.warn("Token grant failed (", res.status, "). Falling back to raw key. Do NOT ship this.");
  return Response.json({ token: key, raw: true });
}