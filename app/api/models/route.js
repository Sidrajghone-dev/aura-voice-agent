export async function GET() {
  const base = process.env.LLM_BASE_URL || "https://api.openai.com/v1";
  const res = await fetch(`${base}/models`, {
    headers: { Authorization: `Bearer ${process.env.LLM_API_KEY}` },
  });
  const data = await res.json();
  const ids = (data.data || []).map((m) => m.id);
  return Response.json(ids.length ? ids : data);
}