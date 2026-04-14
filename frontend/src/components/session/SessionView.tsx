"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import {
  Mic,
  MicOff,
  PhoneOff,
  Volume2,
  Sparkles,
  UserCircle2,
  BarChart3,
  FileText,
  ArrowRight,
  CheckCircle2,
  Clock3,
  ChevronDown,
} from "lucide-react";
import { useSession, type SessionMessage } from "@/hooks/useSession";

interface Message {
  role: "examiner" | "user";
  text: string;
}

interface SessionSummary {
  duration_seconds: number;
  exchanges: number;
  scores: {
    pronunciation_score: number | null;
    grammar_score: number | null;
    vocabulary_score: number | null;
    coherence_score: number | null;
  };
  ai_review: string | null;
  transcript: { role: string; content: string }[];
}

interface SessionViewProps {
  userId: string;
  examType?: string;
  examPart?: number;
  level?: string;
  isDemo?: boolean;
  onSessionEnd?: () => void;
}

export default function SessionView({
  userId,
  examType = "tcf",
  examPart = 1,
  level = "B1",
  isDemo = false,
  onSessionEnd,
}: SessionViewProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionSummary, setSessionSummary] = useState<SessionSummary | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [showReview, setShowReview] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const startTimeRef = useRef<number>(Date.now());

  const examLabel = examType === "tcf" ? "TCF" : "TEF Canada";
  const partLabel = examType === "tcf"
    ? { 1: "Tache 1 - Entretien dirige", 2: "Tache 2 - Interaction", 3: "Tache 3 - Point de vue" }[examPart]
    : { 1: "Section A - Renseignements", 2: "Section B - Argumentation" }[examPart];

  const handleMessage = useCallback(
    (msg: SessionMessage) => {
      switch (msg.type) {
        case "examiner_audio":
        case "part_changed": {
          setIsProcessing(false);
          setMessages((prev) => [...prev, { role: "examiner", text: msg.text || "" }]);

          const audioData = msg.audio || "";
          if (audioData) {
            const audioBlob = new Blob(
              [Uint8Array.from(atob(audioData), (c) => c.charCodeAt(0))],
              { type: "audio/mp3" }
            );
            const audioUrl = URL.createObjectURL(audioBlob);
            const audio = new Audio(audioUrl);
            audioRef.current = audio;
            setIsPlaying(true);
            audio.onended = () => setIsPlaying(false);
            void audio.play();
          }
          break;
        }

        case "transcription": {
          setMessages((prev) => [...prev, { role: "user", text: msg.text || "" }]);
          break;
        }

        case "session_summary": {
          setSessionSummary({
            duration_seconds: msg.duration_seconds ?? 0,
            exchanges: msg.exchanges ?? 0,
            scores: {
              pronunciation_score: msg.scores?.pronunciation_score ?? null,
              grammar_score: msg.scores?.grammar_score ?? null,
              vocabulary_score: msg.scores?.vocabulary_score ?? null,
              coherence_score: msg.scores?.coherence_score ?? null,
            },
            ai_review: msg.ai_review ?? null,
            transcript: msg.transcript ?? [],
          });
          break;
        }
      }
    },
    []
  );

  const {
    connect,
    disconnect,
    startRecording,
    stopRecording,
    isConnected,
    isRecording,
  } = useSession({
    userId,
    examType,
    examPart,
    level,
    isDemo,
    onMessage: handleMessage,
    onError: setError,
    onClose: onSessionEnd,
  });

  // Auto-connect on mount
  useEffect(() => {
    connect();
    startTimeRef.current = Date.now();
    return () => {
      // cleanup on unmount
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Elapsed time counter
  useEffect(() => {
    if (sessionSummary) return;
    const timer = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [sessionSummary]);

  // Auto-scroll transcript
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleRecord = useCallback(() => {
    if (isRecording) {
      stopRecording();
      setIsProcessing(true);
    } else {
      startRecording();
    }
  }, [isRecording, startRecording, stopRecording]);

  const handleEndSession = () => {
    disconnect();
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // -- Session Summary (end-of-session comprehensive review) --
  if (sessionSummary) {
    const { scores } = sessionSummary;
    const allScores = [
      scores.pronunciation_score,
      scores.grammar_score,
      scores.vocabulary_score,
      scores.coherence_score,
    ].filter((s): s is number => s !== null);
    const overall = allScores.length > 0 ? Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length) : 0;

    return (
      <div className="mx-auto max-w-4xl p-6">
        {/* Header */}
        <div className="mb-8 text-center">
          <div className="inline-flex rounded-2xl bg-gradient-to-r from-indigo-500 to-violet-500 p-4 text-white mb-4 shadow-lg shadow-indigo-500/25">
            <CheckCircle2 size={32} />
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">Session Complete</h1>
          <p className="text-slate-400">
            {examLabel} &middot; Part {examPart} &middot; Level {level} &middot; {formatTime(sessionSummary.duration_seconds)} &middot; {sessionSummary.exchanges} exchanges
          </p>
        </div>

        {/* Score Cards */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-5 mb-8">
          <div className="glass-card p-5 text-center col-span-2 md:col-span-1">
            <p className="text-xs text-slate-500 mb-1">Overall</p>
            <p className={`text-4xl font-bold ${overall >= 80 ? "text-emerald-400" : overall >= 60 ? "text-amber-400" : "text-red-400"}`}>
              {overall}
            </p>
            <p className="text-xs text-slate-500">/100</p>
          </div>
          {[
            { label: "Pronunciation", score: scores.pronunciation_score },
            { label: "Grammar", score: scores.grammar_score },
            { label: "Vocabulary", score: scores.vocabulary_score },
            { label: "Coherence", score: scores.coherence_score },
          ].map((item) => (
            <div key={item.label} className="glass-card p-4 text-center">
              <p className="text-xs text-slate-500 mb-1">{item.label}</p>
              <p className={`text-2xl font-bold ${
                (item.score ?? 0) >= 80 ? "text-emerald-400" : (item.score ?? 0) >= 60 ? "text-amber-400" : "text-red-400"
              }`}>
                {item.score ?? "--"}
              </p>
            </div>
          ))}
        </div>

        {/* AI Review */}
        {sessionSummary.ai_review && (
          <div className="glass-card p-6 mb-6">
            <button
              onClick={() => setShowReview(!showReview)}
              className="flex items-center gap-2 w-full text-left"
            >
              <BarChart3 size={16} className="text-indigo-400" />
              <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500 flex-1">AI Review</h3>
              <ChevronDown size={16} className={`text-slate-500 transition-transform ${showReview ? "rotate-180" : ""}`} />
            </button>
            {showReview && (
              <div className="mt-4 text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">
                {sessionSummary.ai_review}
              </div>
            )}
          </div>
        )}

        {/* Transcript */}
        <div className="glass-card p-6 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <FileText size={16} className="text-indigo-400" />
            <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500">Full Transcript</h3>
          </div>
          <div className="max-h-[400px] overflow-y-auto space-y-3 pr-1">
            {sessionSummary.transcript.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                    msg.role === "assistant"
                      ? "bg-indigo-500/10 border border-indigo-400/15 text-slate-200"
                      : "bg-emerald-500/10 border border-emerald-400/15 text-slate-200"
                  }`}
                >
                  <p className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-500">
                    {msg.role === "assistant" ? <Sparkles size={12} /> : <UserCircle2 size={12} />}
                    {msg.role === "assistant" ? "Examiner" : "You"}
                  </p>
                  <p>{msg.content}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-center gap-4">
          <button
            onClick={onSessionEnd}
            className="btn-primary px-8 py-3 font-semibold text-white inline-flex items-center gap-2"
          >
            Go to Dashboard
            <ArrowRight size={16} />
          </button>
        </div>
      </div>
    );
  }

  // -- Active Session View --
  return (
    <div className="mx-auto flex h-[calc(100vh-2rem)] w-full max-w-5xl flex-col rounded-3xl glass-card shadow-2xl shadow-indigo-500/5">
      {/* Header Bar */}
      <div className="flex items-center justify-between border-b border-white/[0.06] px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-gradient-to-tr from-indigo-500 to-violet-500 p-2.5 text-white shadow-lg shadow-indigo-500/25">
            <Mic size={18} />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">{examLabel} Speaking</h2>
            <p className="text-sm text-slate-400">
              {isDemo ? "Demo" : "Live"} &middot; {partLabel} &middot; Level {level}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <Clock3 size={14} className="text-indigo-400" />
            <span className="font-mono">{formatTime(elapsedSeconds)}</span>
          </div>
          <button
            onClick={handleEndSession}
            className="flex items-center gap-2 rounded-xl bg-red-500/20 border border-red-400/20 px-4 py-2 text-red-400 transition-all hover:bg-red-500/30 hover:text-red-300"
          >
            <PhoneOff size={16} />
            End Session
          </button>
        </div>
      </div>

      {/* Main Content: Transcript + Controls */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Live Transcript */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="mx-auto max-w-3xl space-y-3">
            {messages.length === 0 && !isConnected && (
              <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.02] p-6 text-center text-sm text-slate-500">
                Connecting to examiner...
              </div>
            )}

            {messages.length === 0 && isConnected && (
              <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.02] p-6 text-center text-sm text-slate-500">
                <Volume2 size={20} className="mx-auto mb-2 text-indigo-400 animate-pulse" />
                The examiner is preparing to speak...
              </div>
            )}

            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                    msg.role === "examiner"
                      ? "bg-indigo-500/10 border border-indigo-400/15 text-slate-200"
                      : "bg-emerald-500/10 border border-emerald-400/15 text-slate-200"
                  }`}
                >
                  <p className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-500">
                    {msg.role === "examiner" ? <Sparkles size={12} /> : <UserCircle2 size={12} />}
                    {msg.role === "examiner" ? "Examiner" : "You"}
                  </p>
                  <p>{msg.text}</p>
                </div>
              </div>
            ))}

            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mx-6 mb-2 rounded-xl bg-red-500/10 border border-red-400/20 p-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {/* Controls Bar */}
        <div className="border-t border-white/[0.06] px-6 py-5">
          <div className="mx-auto flex max-w-3xl items-center justify-center gap-4">
            {/* Status indicators */}
            {isPlaying && (
              <div className="inline-flex items-center gap-2 rounded-xl bg-indigo-500/10 border border-indigo-400/20 px-4 py-2.5 text-indigo-300">
                <Volume2 size={16} className="animate-pulse" />
                <span className="text-sm">Examiner is speaking...</span>
              </div>
            )}

            {isProcessing && !isPlaying && (
              <div className="inline-flex items-center gap-2 rounded-xl bg-amber-500/10 border border-amber-400/20 px-4 py-2.5 text-amber-300">
                <div className="h-2 w-2 animate-pulse rounded-full bg-amber-400" />
                <span className="text-sm">Processing your response...</span>
              </div>
            )}

            {!isPlaying && !isProcessing && (
              <>
                <button
                  onClick={handleRecord}
                  disabled={isPlaying}
                  className={`flex items-center gap-3 rounded-2xl px-8 py-4 font-semibold text-white transition-all duration-300 ${
                    isRecording
                      ? "bg-red-500/30 border-2 border-red-400/40 text-red-300 shadow-lg shadow-red-500/20 scale-105"
                      : "bg-gradient-to-r from-indigo-500 to-violet-500 hover:shadow-lg hover:shadow-indigo-500/25 hover:scale-105"
                  }`}
                >
                  {isRecording ? (
                    <>
                      <MicOff size={20} />
                      <span>Stop &amp; Send</span>
                      <span className="ml-1 h-3 w-3 animate-pulse rounded-full bg-red-400" />
                    </>
                  ) : (
                    <>
                      <Mic size={20} />
                      <span>Start Speaking</span>
                    </>
                  )}
                </button>

                {!isRecording && (
                  <p className="text-xs text-slate-500">
                    Click to record your response, click again to send.
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
