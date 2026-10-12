"use client";

import { useState, useRef, useEffect } from "react";
import { ALL_ORDERS } from "../lib/orders";

// Use "multi" instead for Hindi/English mixing (Hinglish).
const STT_LANGUAGE = "en-IN";

const FALLBACK_REPLY = "Sorry, I didn't catch that. Could you please repeat it?";

// Phrases evaluators can click instead of speaking.
const QUICK_PHRASES = [
  "Where is my order ORD-101?",
  "Can I cancel ORD-103?",
  "Can I return ORD-102?",
  "Check order ORD-999",
  "Book me a flight to Goa",
];

const STATES = {
  idle: {
    label: "Ready",
    hint: "Press Start Call to talk to Aria",
    gradient: "linear-gradient(135deg, #cbd5e1, #94a3b8)",
    ring: "bg-slate-300",
    pill: "bg-slate-100 text-slate-600",
  },
  listening: {
    label: "Listening",
    hint: "Go ahead, I'm listening",
    gradient: "linear-gradient(135deg, #34d399, #14b8a6)",
    ring: "bg-emerald-400",
    pill: "bg-emerald-50 text-emerald-700",
  },
  thinking: {
    label: "Thinking",
    hint: "One moment...",
    gradient: "linear-gradient(135deg, #fcd34d, #fb923c)",
    ring: "bg-amber-300",
    pill: "bg-amber-50 text-amber-700",
  },
  speaking: {
    label: "Speaking",
    hint: "Aria is speaking",
    gradient: "linear-gradient(135deg, #818cf8, #8b5cf6)",
    ring: "bg-indigo-400",
    pill: "bg-indigo-50 text-indigo-700",
  },
};

const ORDER_STATUS_STYLE = {
  "Out for Delivery": "bg-blue-50 text-blue-700",
  Delivered: "bg-emerald-50 text-emerald-700",
  Processing: "bg-amber-50 text-amber-700",
};

const RESOLUTION_STYLE = {
  RESOLVED: "bg-emerald-50 text-emerald-700",
  UNRESOLVED: "bg-red-50 text-red-700",
  FOLLOW_UP_NEEDED: "bg-amber-50 text-amber-700",
};

function pretty(v) {
  return v ? String(v).replaceAll("_", " ") : "-";
}

function formatTime(total) {
  const m = String(Math.floor(total / 60)).padStart(2, "0");
  const s = String(total % 60).padStart(2, "0");
  return `${m}:${s}`;
}

export default function Home() {
  const [callActive, setCallActive] = useState(false);
  const [callEnded, setCallEnded] = useState(false);
  const [agentState, setAgentState] = useState("idle");
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [interim, setInterim] = useState("");
  const [error, setError] = useState("");
  const [summary, setSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [copied, setCopied] = useState(false);

  // Refs hold the latest values for callbacks (WebSocket handlers can't see fresh state).
  const callActiveRef = useRef(false);
  const stateRef = useRef("idle");
  const messagesRef = useRef([]);
  const bufferRef = useRef("");
  const wsRef = useRef(null);
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const audioRef = useRef(null);
  const chatBoxRef = useRef(null);
  const confRef = useRef([]);
  const lastUnclearRef = useRef(0);

  function setState(s) {
    stateRef.current = s;
    setAgentState(s);
  }

  function updateMessages(m) {
    messagesRef.current = m;
    setMessages(m);
  }

  // Call timer
  useEffect(() => {
    if (!callActive) return;
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [callActive]);

  // Keep the chat scrolled to the latest message
  useEffect(() => {
    const el = chatBoxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, interim, agentState]);

  // ---------- Mic + Deepgram ----------

  async function startMic() {
    // 1. Get the Deepgram credential from our server.
    const tokenRes = await fetch("/api/deepgram-token", { method: "POST" });
    const tokenData = await tokenRes.json();
    if (!tokenData.token) throw new Error(tokenData.error || "No Deepgram key");

    // 2. Ask the browser for microphone access.
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    streamRef.current = stream;

    // 3. Open a live connection to Deepgram.
    const params = new URLSearchParams({
      model: "nova-3",
      language: STT_LANGUAGE,
      smart_format: "true",
      interim_results: "true",
      endpointing: "400", // ms of silence that marks the end of a sentence
      utterance_end_ms: "1000", // backup signal for end of speech
    });
    // "token" is the correct protocol for an API key.
    const ws = new WebSocket(
      `wss://api.deepgram.com/v1/listen?${params.toString()}`,
      ["token", tokenData.token]
    );
    wsRef.current = ws;

    ws.onopen = () => {
      // 4. Send mic audio to Deepgram in small chunks (every 250 ms).
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) ws.send(e.data);
      };
      recorder.start(250);
    };

        ws.onmessage = (e) => {
      const data = JSON.parse(e.data);

      if (data.type === "Results") {
        const alt = data.channel?.alternatives?.[0];
        const text = alt?.transcript || "";
        if (data.is_final) {
          // A finished chunk of speech. Collect it until the speaker pauses.
          if (text) {
            bufferRef.current += (bufferRef.current ? " " : "") + text;
            if (typeof alt.confidence === "number") confRef.current.push(alt.confidence);
          }
          setInterim("");
          // speech_final with no words means sound was heard but nothing was understood.
          if (data.speech_final) flushBuffer(true);
        } else if (stateRef.current === "listening") {
          // Live partial text while the customer is still talking.
          setInterim((bufferRef.current + " " + text).trim());
        }
      } else if (data.type === "UtteranceEnd") {
        flushBuffer(false);
      }
    };

    ws.onerror = () => setError("Connection to speech service failed.");
    ws.onclose = () => {
      if (callActiveRef.current) setError("Speech connection closed. End the call and start again.");
    };
  }

  function stopMic() {
    try {
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.stop();
      }
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "CloseStream" }));
        wsRef.current.close();
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    } catch (e) {
      console.error(e);
    }
    recorderRef.current = null;
    wsRef.current = null;
    streamRef.current = null;
    bufferRef.current = "";
    setInterim("");
  }

    // Called when the customer has finished a sentence.
  function flushBuffer(heardSoundButNoWords = false) {
    const text = bufferRef.current.trim();
    const confs = confRef.current;
    bufferRef.current = "";
    confRef.current = [];
    setInterim("");

    // Ignore speech while Aria is busy (barge-in is a later, optional phase).
    if (stateRef.current !== "listening") return;

    if (!text) {
      if (heardSoundButNoWords) handleUnclear("");
      return;
    }

    const avg = confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : 1;
    const letters = text.replace(/[^a-zA-Z\u0900-\u097F]/g, "");
    console.log("heard:", text, "| confidence:", avg.toFixed(2)); // remove once tuned

    // Low confidence, or almost no letters: treat it as unclear audio.
    if (avg < 0.55 || letters.length < 2) {
      handleUnclear(text);
      return;
    }
    handleUserText(text);
  }

  // Aria asks the customer to repeat, without calling the LLM.
  async function handleUnclear(heardText) {
    const now = Date.now();
    if (now - lastUnclearRef.current < 8000) return; // avoid repeating it nonstop
    lastUnclearRef.current = now;

    const reply = "Sorry, I couldn't hear that clearly. Could you please repeat it?";
    const updated = [
      ...messagesRef.current,
      { role: "user", content: heardText ? `[unclear audio: "${heardText}"]` : "[unclear audio]" },
      { role: "assistant", content: reply },
    ];
    updateMessages(updated);
    setState("speaking");
    await speak(reply);

    if (callActiveRef.current) {
      bufferRef.current = "";
      confRef.current = [];
      setInterim("");
      setState("listening");
    }
  }

  // ---------- Speaking ----------

  function speakWithBrowser(text) {
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "en-IN";
      u.onend = resolve;
      u.onerror = resolve;
      window.speechSynthesis.speak(u);
    });
  }

  // Plays Aria's reply and resolves when the audio finishes.
  async function speak(text) {
    if (!text || !text.trim()) return; // never send empty text to the TTS route
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error("TTS request failed");
      const blob = await res.blob();
      if (!callActiveRef.current) return;

      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      await new Promise((resolve) => {
        audio.onended = resolve;
        audio.onerror = resolve;
        audio.play().catch(resolve);
      });
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Falling back to browser voice:", err);
      if (callActiveRef.current) await speakWithBrowser(text);
    }
  }

  // ---------- Conversation ----------

  async function handleUserText(text) {
    const updated = [...messagesRef.current, { role: "user", content: text }];
    updateMessages(updated);
    setState("thinking");

    let reply;
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: updated }),
      });
      const data = await res.json();
      reply = data.reply || FALLBACK_REPLY;
    } catch (err) {
      reply = "Sorry, something went wrong. Please try again.";
    }
    if (!callActiveRef.current) return; // call ended while thinking

    updateMessages([...updated, { role: "assistant", content: reply }]);
    setState("speaking");
    await speak(reply);

    if (callActiveRef.current) {
      bufferRef.current = ""; // drop anything the mic picked up while Aria spoke
      setInterim("");
      setState("listening");
    }
  }

  async function startCall() {
    setError("");
    callActiveRef.current = true;
    setCallActive(true);
    setCallEnded(false);
    setSummary(null);
    setSeconds(0);

    const greeting = "Hi, this is Aria from Aura Skincare. How can I help you today?";
    updateMessages([{ role: "assistant", content: greeting }]);
    setState("speaking");

    // Start the greeting right away (inside the click, so Chrome allows audio),
    // and set up the microphone while it plays.
    const greetingDone = speak(greeting);

    try {
      await startMic();
    } catch (err) {
      console.error(err);
      setError(
        "Could not start the microphone: " +
          (err.message || "unknown error") +
          ". You can still type below."
      );
    }

    await greetingDone;
    if (callActiveRef.current) {
      bufferRef.current = "";
      setState("listening");
    }
  }

  function endCall() {
    callActiveRef.current = false;
    stopMic();
    window.speechSynthesis.cancel();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.dispatchEvent(new Event("ended"));
      audioRef.current = null;
    }
    setCallActive(false);
    setCallEnded(true);
    setState("idle");
    generateSummary(messagesRef.current);
  }

  async function generateSummary(finalMessages) {
    setSummary(null);
    setSummaryLoading(true);
    try {
      const res = await fetch("/api/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: finalMessages }),
      });
      const data = await res.json();
      setSummary(data.summary);
    } catch (err) {
      setSummary({ error: "Could not generate summary." });
    }
    setSummaryLoading(false);
  }

  function sendTyped() {
    const text = input.trim();
    if (!text || stateRef.current !== "listening") return;
    setInput("");
    handleUserText(text);
  }

  function sendQuick(text) {
    if (stateRef.current !== "listening") return;
    handleUserText(text);
  }

  async function copySummary() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(summary, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      console.error(e);
    }
  }

  const s = STATES[agentState];
  const canSend = callActive && agentState === "listening";

  return (
    <main className="min-h-screen bg-slate-100 text-slate-900">
      {/* Header */}
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="h-10 w-10 rounded-xl flex items-center justify-center text-white font-bold"
              style={{ background: "linear-gradient(135deg, #34d399, #0d9488)" }}
            >
              A
            </div>
            <div>
              <h1 className="text-lg font-semibold leading-tight">Aura Skincare</h1>
              <p className="text-xs text-slate-500">Voice Support with Aria</p>
            </div>
          </div>
          <span className={`px-3 py-1 rounded-full text-xs font-medium ${s.pill}`}>
            {s.label}
          </span>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 py-6 grid gap-6 lg:grid-cols-3">
        {/* Left: call + results */}
        <div className="lg:col-span-2 space-y-6">
          {/* Call card */}
          <section className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            {/* Orb + controls */}
            <div className="px-6 py-6 flex flex-col items-center text-center border-b border-slate-100">
              <div className="relative flex items-center justify-center h-32 w-32">
                {(agentState === "listening" || agentState === "speaking") && (
                  <span
                    className={`absolute inline-flex h-full w-full rounded-full opacity-30 animate-ping ${s.ring}`}
                  />
                )}
                <div
                  className={`relative h-24 w-24 rounded-full shadow-lg flex items-center justify-center text-white transition-all duration-500 ${
                    agentState === "thinking" ? "animate-pulse" : ""
                  }`}
                  style={{ background: s.gradient }}
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-9 w-9"
                  >
                    <rect x="9" y="2" width="6" height="12" rx="3" />
                    <path d="M5 11a7 7 0 0 0 14 0M12 18v4" />
                  </svg>
                </div>
              </div>

              <p className="mt-3 text-base font-medium">{s.hint}</p>
              <p className="text-sm text-slate-500 tabular-nums">
                {callActive ? formatTime(seconds) : callEnded ? `Call ended - ${formatTime(seconds)}` : "00:00"}
              </p>

              <div className="mt-4">
                {!callActive ? (
                  <button
                    onClick={startCall}
                    className="bg-emerald-600 hover:bg-emerald-700 transition-colors text-white font-medium px-8 py-3 rounded-full shadow"
                  >
                    Start Call
                  </button>
                ) : (
                  <button
                    onClick={endCall}
                    className="bg-red-600 hover:bg-red-700 transition-colors text-white font-medium px-8 py-3 rounded-full shadow"
                  >
                    End Call
                  </button>
                )}
              </div>
            </div>

            {error && (
              <div className="mx-6 mt-4 p-3 rounded-lg bg-red-50 text-red-700 text-sm border border-red-100">
                {error}
              </div>
            )}

            {/* Conversation */}
            <div ref={chatBoxRef} className="h-80 overflow-y-auto px-6 py-4 space-y-3 bg-slate-50">
              {messages.length === 0 && (
                <p className="text-sm text-slate-400 text-center mt-24">
                  The conversation will appear here.
                </p>
              )}

              {messages.map((m, i) =>
                m.role === "user" ? (
                  <div key={i} className="flex justify-end">
                    <div className="max-w-[80%]">
                      <p className="text-[11px] text-slate-400 text-right mb-0.5">Customer</p>
                      <div className="bg-indigo-600 text-white px-4 py-2 rounded-2xl rounded-br-md text-sm">
                        {m.content}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div key={i} className="flex items-end gap-2">
                    <div
                      className="h-7 w-7 shrink-0 rounded-full flex items-center justify-center text-white text-xs font-semibold"
                      style={{ background: "linear-gradient(135deg, #34d399, #0d9488)" }}
                    >
                      A
                    </div>
                    <div className="max-w-[80%]">
                      <p className="text-[11px] text-slate-400 mb-0.5">Aria</p>
                      <div className="bg-white border border-slate-200 px-4 py-2 rounded-2xl rounded-bl-md text-sm">
                        {m.content}
                      </div>
                    </div>
                  </div>
                )
              )}

              {interim && (
                <div className="flex justify-end">
                  <div className="max-w-[80%] border border-dashed border-indigo-300 text-indigo-700 italic px-4 py-2 rounded-2xl rounded-br-md text-sm bg-indigo-50">
                    {interim}
                  </div>
                </div>
              )}

              {agentState === "thinking" && (
                <div className="flex items-end gap-2">
                  <div
                    className="h-7 w-7 shrink-0 rounded-full flex items-center justify-center text-white text-xs font-semibold"
                    style={{ background: "linear-gradient(135deg, #34d399, #0d9488)" }}
                  >
                    A
                  </div>
                  <div className="bg-white border border-slate-200 px-4 py-3 rounded-2xl rounded-bl-md flex gap-1">
                    {[0, 150, 300].map((d) => (
                      <span
                        key={d}
                        className="h-2 w-2 rounded-full bg-slate-400 animate-bounce"
                        style={{ animationDelay: `${d}ms` }}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Quick phrases + typed input */}
            {callActive && (
              <div className="px-6 py-4 border-t border-slate-100 space-y-3">
                <div>
                  <p className="text-xs text-slate-500 mb-2">Quick test phrases</p>
                  <div className="flex flex-wrap gap-2">
                    {QUICK_PHRASES.map((p) => (
                      <button
                        key={p}
                        onClick={() => sendQuick(p)}
                        disabled={!canSend}
                        className="text-xs px-3 py-1.5 rounded-full border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 transition-colors"
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex gap-2">
                  <input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && sendTyped()}
                    placeholder="Or type here (fallback for testing)"
                    className="flex-1 border border-slate-200 rounded-full px-4 py-2 text-sm outline-none focus:border-indigo-400"
                  />
                  <button
                    onClick={sendTyped}
                    disabled={!canSend}
                    className="bg-slate-900 text-white text-sm px-5 py-2 rounded-full disabled:opacity-40"
                  >
                    Send
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* Post-call results */}
          {callEnded && (
            <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-6">
              <h2 className="text-lg font-semibold">Post-call report</h2>

              {/* Summary fields */}
              <div>
                <h3 className="text-sm font-semibold text-slate-700 mb-3">Call outcome</h3>
                {summaryLoading && <p className="text-sm text-slate-500">Generating summary...</p>}
                {summary && summary.customer_intent && (
                  <div className="grid sm:grid-cols-3 gap-3 mb-4">
                    <div className="rounded-xl border border-slate-200 p-3">
                      <p className="text-xs text-slate-500">Intent</p>
                      <p className="text-sm font-medium mt-1">{pretty(summary.customer_intent)}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 p-3">
                      <p className="text-xs text-slate-500">Order ID</p>
                      <p className="text-sm font-mono font-medium mt-1">{summary.order_id || "-"}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 p-3">
                      <p className="text-xs text-slate-500">Resolution</p>
                      <span
                        className={`inline-block mt-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                          RESOLUTION_STYLE[summary.resolution_status] || "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {pretty(summary.resolution_status)}
                      </span>
                    </div>
                    <div className="sm:col-span-3 rounded-xl border border-slate-200 p-3">
                      <p className="text-xs text-slate-500">Summary</p>
                      <p className="text-sm mt-1">{summary.call_summary}</p>
                    </div>
                  </div>
                )}
                {summary && (
                  <div className="relative">
                    <button
                      onClick={copySummary}
                      className="absolute top-2 right-2 text-xs px-2 py-1 rounded bg-slate-700 text-slate-100 hover:bg-slate-600"
                    >
                      {copied ? "Copied" : "Copy"}
                    </button>
                    <pre className="bg-slate-900 text-emerald-300 text-xs p-4 rounded-xl overflow-x-auto whitespace-pre-wrap">
                      {JSON.stringify(summary, null, 2)}
                    </pre>
                  </div>
                )}
              </div>

              {/* Transcript */}
              <div>
                <h3 className="text-sm font-semibold text-slate-700 mb-3">Transcript</h3>
                <div className="space-y-2 text-sm">
                  {messages.map((m, i) => (
                    <div key={i} className="flex gap-2">
                      <span
                        className={`shrink-0 w-20 font-semibold ${
                          m.role === "user" ? "text-indigo-600" : "text-emerald-700"
                        }`}
                      >
                        {m.role === "user" ? "Customer" : "Aria"}
                      </span>
                      <span className="text-slate-700">{m.content}</span>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}
        </div>

        {/* Right: test orders */}
        <aside className="space-y-4">
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
            <h2 className="font-semibold">Test Orders</h2>
            <p className="text-sm text-slate-500">Use these IDs to test order lookups.</p>
            <div className="mt-4 space-y-3">
              {ALL_ORDERS.map((o) => (
                <div key={o.order_id} className="rounded-xl border border-slate-200 p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-bold">{o.order_id}</span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        ORDER_STATUS_STYLE[o.status] || "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {o.status}
                    </span>
                  </div>
                  <p className="mt-2 text-slate-800">{o.product}</p>
                  <p className="text-slate-500">
                    {o.customer} - ₹{o.value}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">{o.notes}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 text-sm text-slate-600">
            <h3 className="font-semibold text-slate-800 mb-2">Try asking</h3>
            <ul className="space-y-1 list-disc list-inside">
              <li>Where is my order?</li>
              <li>Can I return it? I opened it 20 days ago.</li>
              <li>What is your shipping policy?</li>
              <li>Is cash on delivery available?</li>
            </ul>
            <p className="mt-3 text-xs text-slate-400">Use headphones to avoid echo.</p>
          </div>
        </aside>
      </div>
    </main>
  );
}