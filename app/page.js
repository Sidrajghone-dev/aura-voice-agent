"use client";

import { useState, useRef } from "react";
import { ALL_ORDERS } from "../lib/orders";

const STATES = {
  idle: { label: "Idle", dot: "bg-gray-400" },
  listening: { label: "Listening", dot: "bg-green-500" },
  thinking: { label: "Thinking", dot: "bg-yellow-500" },
  speaking: { label: "Speaking", dot: "bg-blue-500" },
};

export default function Home() {
  const [callActive, setCallActive] = useState(false);
  const [callEnded, setCallEnded] = useState(false);
  const [agentState, setAgentState] = useState("idle");
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const callActiveRef = useRef(false);

  function startCall() {
    callActiveRef.current = true;
    setCallActive(true);
    setCallEnded(false);
    setMessages([
      {
        role: "assistant",
        content: "Hi, this is Aria from Aura Skincare. How can I help you today?",
      },
    ]);
    setAgentState("listening");
  }

  function endCall() {
    callActiveRef.current = false;
    setCallActive(false);
    setCallEnded(true);
    setAgentState("idle");
  }

  async function sendMessage() {
    const text = input.trim();
    if (!text || agentState !== "listening") return;

    const updated = [...messages, { role: "user", content: text }];
    setMessages(updated);
    setInput("");
    setAgentState("thinking");

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: updated }),
      });
      const data = await res.json();
      if (!callActiveRef.current) return; // call was ended while thinking

      setMessages([...updated, { role: "assistant", content: data.reply }]);
      setAgentState("speaking");
      // Placeholder: in Phase 11 this waits for the real audio to finish.
      setTimeout(() => {
        if (callActiveRef.current) setAgentState("listening");
      }, 1000);
    } catch (err) {
      setMessages([
        ...updated,
        { role: "assistant", content: "Sorry, something went wrong. Please try again." },
      ]);
      setAgentState("listening");
    }
  }

  const s = STATES[agentState];

  return (
    <main className="min-h-screen bg-gray-50 text-gray-900 p-6">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-2xl font-bold">Aura Skincare - Voice Support (Aria)</h1>

        <div className="mt-6 grid gap-6 md:grid-cols-3">
          {/* Call panel */}
          <section className="md:col-span-2 bg-white rounded-xl shadow p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={`inline-block w-3 h-3 rounded-full ${s.dot}`} />
                <span className="font-medium">{s.label}</span>
              </div>
              {!callActive ? (
                <button
                  onClick={startCall}
                  className="bg-green-600 text-white px-4 py-2 rounded-lg"
                >
                  Start Call
                </button>
              ) : (
                <button
                  onClick={endCall}
                  className="bg-red-600 text-white px-4 py-2 rounded-lg"
                >
                  End Call
                </button>
              )}
            </div>

            <div className="mt-4 h-80 overflow-y-auto border rounded-lg p-3 space-y-2 bg-gray-50">
              {messages.length === 0 && (
                <p className="text-gray-500 text-sm">
                  Click Start Call to begin.
                </p>
              )}
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={m.role === "user" ? "text-right" : "text-left"}
                >
                  <span className="text-xs text-gray-500 block">
                    {m.role === "user" ? "Customer" : "Aria"}
                  </span>
                  <span
                    className={`inline-block px-3 py-2 rounded-lg ${
                      m.role === "user"
                        ? "bg-blue-600 text-white"
                        : "bg-white border"
                    }`}
                  >
                    {m.content}
                  </span>
                </div>
              ))}
            </div>

            {callActive && (
              <div className="mt-3 flex gap-2">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && sendMessage()}
                  placeholder="Type what the customer says (temporary, until voice is added)"
                  className="flex-1 border rounded-lg px-3 py-2"
                />
                <button
                  onClick={sendMessage}
                  disabled={agentState !== "listening"}
                  className="bg-gray-900 text-white px-4 py-2 rounded-lg disabled:opacity-40"
                >
                  Send
                </button>
              </div>
            )}

            {callEnded && (
              <div className="mt-4 p-3 border rounded-lg bg-yellow-50 text-sm">
                Call ended. The structured JSON summary will appear here in Phase 12.
              </div>
            )}
          </section>

          {/* Test orders helper */}
          <aside className="bg-white rounded-xl shadow p-5">
            <h2 className="font-semibold">Test Orders</h2>
            <p className="text-sm text-gray-500">
              Use these IDs to test order lookups.
            </p>
            <div className="mt-3 space-y-3">
              {ALL_ORDERS.map((o) => (
                <div key={o.order_id} className="border rounded-lg p-3 text-sm">
                  <div className="font-mono font-bold">{o.order_id}</div>
                  <div>{o.customer}</div>
                  <div>{o.product}</div>
                  <div>Rs. {o.value}</div>
                  <div className="font-medium">{o.status}</div>
                  <div className="text-gray-500">{o.notes}</div>
                </div>
              ))}
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}