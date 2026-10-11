export async function POST(request) {
  const { text } = await request.json();
  const key = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;

  if (!key || !voiceId || !text) {
    return Response.json({ error: "Missing key, voice ID or text" }, { status: 400 });
  }

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: {
        "xi-api-key": key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_flash_v2_5", // fast model, handles English and Hindi
      }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    console.error("ElevenLabs error:", res.status, err);
    return Response.json({ error: "TTS failed" }, { status: 500 });
  }

  // Pass the audio straight through to the browser.
  return new Response(res.body, { headers: { "Content-Type": "audio/mpeg" } });
}