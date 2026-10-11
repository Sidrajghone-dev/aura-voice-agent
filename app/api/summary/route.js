import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.LLM_API_KEY,
  baseURL: process.env.LLM_BASE_URL || undefined,
});

const SUMMARY_PROMPT = `You analyse customer support call transcripts for Aura Skincare.
Return ONLY a JSON object, with no explanation and no markdown, in exactly this shape:
{
  "customer_intent": one of "ORDER_TRACKING", "ORDER_CANCELLATION", "RETURN_REFUND", "POLICY_QUESTION", "PRODUCT_QUESTION", "OUT_OF_SCOPE", "OTHER",
  "order_id": the order ID the customer asked about in format "ORD-101", or null if none was discussed,
  "resolution_status": one of "RESOLVED", "UNRESOLVED", "FOLLOW_UP_NEEDED",
  "call_summary": "1 to 2 sentences describing what the customer wanted and what Aria told them"
}
Rules:
- RESOLVED means the customer's question was answered or the request was handled within policy, even if the answer was "not eligible".
- UNRESOLVED means Aria could not help, the order was not found, or the call ended before an answer.
- FOLLOW_UP_NEEDED means the customer must contact the support team or take another step.
- Use only facts that appear in the transcript. Never invent details.`;

function fallbackSummary(messages) {
  const userTurns = messages.filter((m) => m.role === "user");
  return {
    customer_intent: "OTHER",
    order_id: null,
    resolution_status: userTurns.length ? "UNRESOLVED" : "UNRESOLVED",
    call_summary: userTurns.length
      ? "The customer spoke with Aria, but an automatic summary could not be generated."
      : "The customer ended the call without asking anything.",
  };
}

export async function POST(request) {
  const { messages } = await request.json();

  if (!messages || !messages.some((m) => m.role === "user")) {
    return Response.json({ summary: fallbackSummary(messages || []) });
  }

  const transcript = messages
    .map((m) => `${m.role === "user" ? "Customer" : "Aria"}: ${m.content}`)
    .join("\n");

  try {
    const res = await client.chat.completions.create({
      model: process.env.LLM_MODEL || "gpt-4o-mini",
      messages: [
        { role: "system", content: SUMMARY_PROMPT },
        { role: "user", content: `Transcript:\n${transcript}` },
      ],
      temperature: 0,
      max_tokens: 1000, // generous, because some models spend tokens on hidden reasoning
    });

    const raw = res.choices[0].message.content || "";
    // Models sometimes wrap JSON in text or code fences, so cut out the {...} part.
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end === -1) throw new Error("No JSON found in: " + raw);
    const summary = JSON.parse(raw.slice(start, end + 1));

    return Response.json({ summary });
  } catch (err) {
    console.error("Summary error:", err);
    return Response.json({ summary: fallbackSummary(messages), error: true });
  }
}