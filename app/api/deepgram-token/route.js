export async function POST() {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) {
    return Response.json({ error: "DEEPGRAM_API_KEY is missing" }, { status: 500 });
  }
  // Demo-only: this key is limited, expires, and is used for nothing else.
  return Response.json({ token: key });
}