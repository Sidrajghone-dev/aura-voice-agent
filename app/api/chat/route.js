import OpenAI from "openai";
import { SYSTEM_PROMPT } from "../../../lib/prompt";
import { getOrderDetails } from "../../../lib/orders";

const client = new OpenAI({
  apiKey: process.env.LLM_API_KEY,
  baseURL: process.env.LLM_BASE_URL || undefined,
});

const MODEL = process.env.LLM_MODEL || "gpt-4o-mini";
const FALLBACK_REPLY = "Sorry, I didn't catch that. Could you please repeat it?";

// Describes the tool to the LLM. The LLM reads this and decides when to call it.
const tools = [
  {
    type: "function",
    function: {
      name: "get_order_details",
      description:
        "Look up an Aura Skincare order by its order ID (format ORD-123). Use this whenever the customer asks about the status, delivery, cancellation or return eligibility of an order.",
      parameters: {
        type: "object",
        properties: {
          order_id: {
            type: "string",
            description: "The order ID the customer gave, e.g. ORD-101",
          },
        },
        required: ["order_id"],
      },
    },
  },
];

export async function POST(request) {
  const { messages } = await request.json();
  const convo = [{ role: "system", content: SYSTEM_PROMPT }, ...messages];
  const toolsUsed = [];

  try {
    // Loop: the LLM may call a tool, we run it, then the LLM writes the final answer.
    for (let i = 0; i < 4; i++) {
      const res = await client.chat.completions.create({
        model: MODEL,
        messages: convo,
        tools,
        temperature: 0.3,
        max_tokens: 1000, // reasoning models need room to think AND answer
        // Keep the hidden thinking short so replies are fast (gpt-oss models only).
        ...(MODEL.includes("gpt-oss") ? { reasoning_effort: "low" } : {}),
      });

      const msg = res.choices[0].message;

      // No tool requested: this is the final spoken reply.
      if (!msg.tool_calls || msg.tool_calls.length === 0) {
        const reply = (msg.content || "").trim();
        return Response.json({ reply: reply || FALLBACK_REPLY, toolsUsed });
      }

      // Tool requested: keep only the fields the API needs, then run the tool.
      convo.push({
        role: "assistant",
        content: msg.content || "",
        tool_calls: msg.tool_calls,
      });

      for (const call of msg.tool_calls) {
        let args = {};
        try {
          args = JSON.parse(call.function.arguments || "{}");
        } catch (e) {
          args = {};
        }
        const result = getOrderDetails(args.order_id);
        toolsUsed.push({ name: call.function.name, args, result });
        convo.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(result),
        });
      }
    }

    return Response.json({
      reply: "Sorry, I'm having trouble with that. Could you please try again?",
      toolsUsed,
    });
  } catch (err) {
    console.error("Chat error:", err);
    return Response.json(
      { reply: "Sorry, I'm having a technical issue. Please try again in a moment.", error: true },
      { status: 500 }
    );
  }
}