"use client";

import { useState, useRef } from "react";
import { ALL_ORDERS } from "../lib/orders";

// Use "multi" instead for Hindi/English mixing (Hinglish).
const STT_LANGUAGE = "en-IN";

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
  const [interim, setInterim] = useState("");
  const [error, setError] = useState("");

  // Refs hold the latest values for callbacks (WebSocket handlers can't see fresh state).
  const callActiveRef = useRef(false);
  const stateRef = useRef("idle");
  const messagesRef = useRef([]);
  const bufferRef = useRef("");
  const wsRef = useRef(null);
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const audioRef = useRef(null);

  function setState(s) {
    stateRef.current = s;
    setAgentState(s);
  }

  function updateMessages(m) {
    messagesRef.current = m;
    setMessages(m);
  }

  // ---------- Mic + Deepgram ----------

  async function startMic() {
    // 1. Get a short-lived token from our server.
    const tokenRes = await fetch("/api/deepgram-token", { method: "POST" });
    const tokenData = await tokenRes.json();
    if (!tokenData.token) throw new Error(tokenData.error || "No Deepgram token");

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
    const ws = new WebSocket(
      `wss://api.deepgram.com/v1/listen?${params.toString()}`,
         [tokenData.raw ? "token" : "bearer", tokenData.token]
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
        const text = data.channel?.alternatives?.[0]?.transcript || "";
        if (data.is_final) {
          // A finished chunk of speech. Collect it until the speaker pauses.
          if (text) {
            bufferRef.current += (bufferRef.current ? " " : "") + text;
          }
          setInterim("");
          if (data.speech_final) flushBuffer();
        } else if (stateRef.current === "listening") {
          // Live partial text while the customer is still talking.
          setInterim((bufferRef.current + " " + text).trim());
        }
      } else if (data.type === "UtteranceEnd") {
        flushBuffer();
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
  function flushBuffer() {
    const text = bufferRef.current.trim();
    bufferRef.current = "";
    setInterim("");
    if (!text) return;
    // Phase 10: ignore speech while Aria is busy. Phase 13 adds proper interruption.
    if (stateRef.current !== "listening") return;
    handleUserText(text);
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
      reply = data.reply;
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
  }

  function sendTyped() {
    const text = input.trim();
    if (!text || stateRef.current !== "listening") return;
    setInput("");
    handleUserText(text);
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

            {error && (
              <div className="mt-3 p-2 rounded bg-red-50 text-red-700 text-sm">{error}</div>
            )}

            <div className="mt-4 h-80 overflow-y-auto border rounded-lg p-3 space-y-2 bg-gray-50">
              {messages.length === 0 && (
                <p className="text-gray-500 text-sm">Click Start Call to begin.</p>
              )}
              {messages.map((m, i) => (
                <div key={i} className={m.role === "user" ? "text-right" : "text-left"}>
                  <span className="text-xs text-gray-500 block">
                    {m.role === "user" ? "Customer" : "Aria"}
                  </span>
                  <span
                    className={`inline-block px-3 py-2 rounded-lg ${
                      m.role === "user" ? "bg-blue-600 text-white" : "bg-white border"
                    }`}
                  >
                    {m.content}
                  </span>
                </div>
              ))}
              {interim && (
                <div className="text-right">
                  <span className="inline-block px-3 py-2 rounded-lg bg-blue-200 text-blue-900 italic">
                    {interim}
                  </span>
                </div>
              )}
            </div>

            {callActive && (
              <div className="mt-3 flex gap-2">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && sendTyped()}
                  placeholder="Or type here (fallback for testing)"
                  className="flex-1 border rounded-lg px-3 py-2"
                />
                <button
                  onClick={sendTyped}
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
            <p className="text-sm text-gray-500">Use these IDs to test order lookups.</p>
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