"use client";

import { useState, useCallback, useRef, useEffect, type ComponentType, type ReactNode } from "react";
import {
  Mic,
  MicOff,
  PhoneOff,
  Volume2,
  Clock3,
  BookOpen,
  GraduationCap,
  MessageSquare,
  UserCircle2,
  Target,
  TrendingUp,
  Trophy,
  Calendar,
  CheckCircle2,
  Sparkles,
} from "lucide-react";
import { useSession, type SessionMessage } from "@/hooks/useSession";

interface Message {
  role: "examiner" | "user";
  text: string;
  pronunciation?: {
    accuracy_score: number;
    fluency_score: number;
    completeness_score: number;
    pronunciation_score: number;
  };
  evaluation?: {
    grammar_score: number;
    vocabulary_score: number;
    coherence_score: number;
    feedback: string;
  };
}

interface SessionViewProps {
  userId: string;
  examPart?: number;
  level?: string;
  isDemo?: boolean;
  onSessionEnd?: () => void;
}

type Phase = "idle" | "preparation" | "recording";
type ExerciseCategory = "presentation" | "opinion" | "description" | "conversation";

interface Exercise {
  id: string;
  category: ExerciseCategory;
  title: string;
  question: string;
  preparationTime: number;
  responseTime: number;
  examType: "TEF" | "TCF";
  level: string;
  examPart: number;
}

interface EvaluationSnapshot {
  score: number;
  pronunciation: number | null;
  grammar: number;
  vocabulary: number;
  coherence: number;
  feedback: string;
}

const EXERCISES: Record<ExerciseCategory, Exercise[]> = {
  presentation: [
    {
      id: "p1",
      category: "presentation",
      title: "Personal Presentation",
      question:
        "Introduce yourself. Explain your professional background, your strongest skills, and your 5-year goals.",
      preparationTime: 30,
      responseTime: 90,
      examType: "TEF",
      level: "B2-C1",
      examPart: 1,
    },
    {
      id: "p2",
      category: "presentation",
      title: "Your City and Region",
      question:
        "Describe your hometown or region, what makes it special, and why someone should visit it.",
      preparationTime: 30,
      responseTime: 90,
      examType: "TCF",
      level: "B1-B2",
      examPart: 1,
    },
  ],
  opinion: [
    {
      id: "o1",
      category: "opinion",
      title: "Social Media Impact",
      question:
        "Do social media platforms have a mostly positive or negative impact on society? Support your position with concrete examples.",
      preparationTime: 45,
      responseTime: 120,
      examType: "TEF",
      level: "B2-C1",
      examPart: 3,
    },
    {
      id: "o2",
      category: "opinion",
      title: "Remote Work Debate",
      question:
        "Should remote work become the default model for office jobs? Explain your point of view and address a counterargument.",
      preparationTime: 45,
      responseTime: 120,
      examType: "TCF",
      level: "B2",
      examPart: 3,
    },
  ],
  description: [
    {
      id: "d1",
      category: "description",
      title: "Daily Routine",
      question:
        "Describe your typical day from morning to evening and explain why these activities matter to you.",
      preparationTime: 30,
      responseTime: 90,
      examType: "TEF",
      level: "A2-B1",
      examPart: 1,
    },
    {
      id: "d2",
      category: "description",
      title: "Memorable Event",
      question:
        "Talk about an important event in your life and explain how it influenced your personality or choices.",
      preparationTime: 45,
      responseTime: 120,
      examType: "TCF",
      level: "B2",
      examPart: 1,
    },
  ],
  conversation: [
    {
      id: "c1",
      category: "conversation",
      title: "Customer Support Scenario",
      question:
        "You call customer support because your online order never arrived. Explain the issue and request a concrete solution.",
      preparationTime: 20,
      responseTime: 60,
      examType: "TEF",
      level: "B1",
      examPart: 2,
    },
    {
      id: "c2",
      category: "conversation",
      title: "Travel Planning",
      question:
        "A friend invites you on a trip next month. Discuss destination options, budget constraints, and your preferences.",
      preparationTime: 20,
      responseTime: 60,
      examType: "TCF",
      level: "B1-B2",
      examPart: 2,
    },
  ],
};

const CATEGORIES: Array<{
  id: ExerciseCategory;
  label: string;
  icon: ComponentType<{ size?: number; className?: string }>;
}> = [
  { id: "presentation", label: "Presentation", icon: Mic },
  { id: "opinion", label: "Opinion", icon: BookOpen },
  { id: "description", label: "Description", icon: GraduationCap },
  { id: "conversation", label: "Conversation", icon: MessageSquare },
];

export default function SessionView({
  userId,
  level = "B1",
  isDemo = false,
  onSessionEnd,
}: SessionViewProps) {
  const [activeCategory, setActiveCategory] = useState<ExerciseCategory>("presentation");
  const [exerciseIndex, setExerciseIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("idle");
  const [timeLeft, setTimeLeft] = useState(0);

  const [messages, setMessages] = useState<Message[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionSummary, setSessionSummary] = useState<SessionMessage | null>(null);
  const [latestEvaluation, setLatestEvaluation] = useState<EvaluationSnapshot | null>(null);
  const [latestPronunciation, setLatestPronunciation] = useState<number | null>(null);
  const [scoreHistory, setScoreHistory] = useState<number[]>([]);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const activeExercises = EXERCISES[activeCategory];
  const activeExercise = activeExercises[exerciseIndex] || activeExercises[0];

  const completedResponses = messages.filter((m) => m.role === "user").length;
  const averageScore =
    scoreHistory.length > 0
      ? Math.round(scoreHistory.reduce((sum, value) => sum + value, 0) / scoreHistory.length)
      : null;
  const bestScore = scoreHistory.length > 0 ? Math.max(...scoreHistory) : null;

  const handleMessage = useCallback(
    (msg: SessionMessage) => {
      switch (msg.type) {
        case "examiner_audio": {
          setMessages((prev) => [...prev, { role: "examiner", text: msg.text || "" }]);

          const audioData = msg.audio || "";
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
          break;
        }

        case "transcription": {
          setLatestPronunciation(msg.pronunciation?.pronunciation_score ?? null);
          setMessages((prev) => [
            ...prev,
            {
              role: "user",
              text: msg.text || "",
              pronunciation: msg.pronunciation,
            },
          ]);
          break;
        }

        case "evaluation": {
          const grammar = msg.scores?.grammar_score ?? 0;
          const vocabulary = msg.scores?.vocabulary_score ?? 0;
          const coherence = msg.scores?.coherence_score ?? 0;

          const components = [grammar, vocabulary, coherence];
          if (latestPronunciation !== null) {
            components.push(latestPronunciation);
          }
          const overall = Math.round(
            components.reduce((sum, value) => sum + value, 0) / components.length
          );

          setLatestEvaluation({
            score: overall,
            pronunciation: latestPronunciation,
            grammar,
            vocabulary,
            coherence,
            feedback:
              msg.scores?.feedback || "Keep practicing to improve clarity and structure.",
          });
          setScoreHistory((prev) => [...prev, overall]);

          setMessages((prev) => {
            const updated = [...prev];
            const lastUserMsg = updated.findLastIndex((m) => m.role === "user");
            if (lastUserMsg !== -1) {
              updated[lastUserMsg] = {
                ...updated[lastUserMsg],
                evaluation: msg.scores,
              };
            }
            return updated;
          });
          break;
        }

        case "session_summary": {
          setSessionSummary(msg);
          break;
        }
      }
    },
    [latestPronunciation]
  );

  const {
    connect,
    disconnect,
    startRecording,
    stopRecording,
    changePart,
    isConnected,
    isRecording,
  } = useSession({
    userId,
    examPart: activeExercise.examPart,
    level,
    isDemo,
    onMessage: handleMessage,
    onError: setError,
    onClose: onSessionEnd,
  });

  useEffect(() => {
    if (phase === "idle" || timeLeft <= 0) {
      return;
    }

    const timer = window.setTimeout(() => {
      setTimeLeft((prev) => prev - 1);
    }, 1000);

    return () => window.clearTimeout(timer);
  }, [phase, timeLeft]);

  useEffect(() => {
    if (timeLeft > 0) {
      return;
    }

    if (phase === "preparation") {
      setPhase("recording");
      setTimeLeft(activeExercise.responseTime);
      return;
    }

    if (phase === "recording") {
      setPhase("idle");
      setExerciseIndex((prev) => (prev + 1) % activeExercises.length);
    }
  }, [timeLeft, phase, activeExercise.responseTime, activeExercises.length]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    setExerciseIndex(0);
    if (isConnected) {
      const firstExercise = EXERCISES[activeCategory][0];
      changePart(firstExercise.examPart);
    }
  }, [activeCategory, changePart, isConnected]);

  const startExercise = () => {
    if (!isConnected) {
      connect();
    }
    changePart(activeExercise.examPart);
    setPhase("preparation");
    setTimeLeft(activeExercise.preparationTime);
    setError(null);
  };

  const handleEndSession = () => {
    disconnect();
    setPhase("idle");
    setTimeLeft(0);
    onSessionEnd?.();
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  if (sessionSummary) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <h2 className="font-display mb-4 text-3xl text-white">Session Summary</h2>
        <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
          <ScoreCard label="Pronunciation" score={sessionSummary.scores?.pronunciation_score} />
          <ScoreCard label="Grammar" score={sessionSummary.scores?.grammar_score} />
          <ScoreCard label="Vocabulary" score={sessionSummary.scores?.vocabulary_score} />
          <ScoreCard label="Coherence" score={sessionSummary.scores?.coherence_score} />
        </div>
        <p className="text-slate-400">
          Duration: {Math.round((sessionSummary.duration_seconds ?? 0) / 60)} minutes | {" "}
          {sessionSummary.exchanges ?? 0} exchanges
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-2rem)] w-full max-w-7xl flex-col rounded-3xl glass-card shadow-2xl shadow-indigo-500/5">
      {/* Header Bar */}
      <div className="flex items-center justify-between border-b border-white/[0.06] px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-gradient-to-tr from-indigo-500 to-violet-500 p-2.5 text-white shadow-lg shadow-indigo-500/25">
            <Mic size={18} />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">Speaking Simulator</h2>
            <p className="text-sm text-slate-400">
              {isDemo ? "Demo Mode" : "Live Practice"} | Part {activeExercise.examPart} | Level {level}
            </p>
          </div>
        </div>
        <button
          onClick={handleEndSession}
          className="flex items-center gap-2 rounded-xl bg-red-500/20 border border-red-400/20 px-4 py-2 text-red-400 transition-all hover:bg-red-500/30 hover:text-red-300"
        >
          <PhoneOff size={16} />
          End
        </button>
      </div>

      <div className="grid flex-1 gap-6 overflow-hidden p-6 lg:grid-cols-3">
        {/* Main Content */}
        <div className="space-y-5 overflow-y-auto lg:col-span-2">
          {/* Category Tabs */}
          <div className="grid grid-cols-2 gap-2 glass-card p-4 md:grid-cols-4">
            {CATEGORIES.map((category) => (
              <button
                key={category.id}
                onClick={() => setActiveCategory(category.id)}
                className={`flex items-center justify-center gap-2 rounded-xl px-3 py-3 text-sm font-medium transition-all duration-300 ${
                  activeCategory === category.id
                    ? "bg-gradient-to-r from-indigo-500 to-violet-500 text-white shadow-lg shadow-indigo-500/25"
                    : "text-slate-400 hover:text-white hover:bg-white/[0.06]"
                }`}
              >
                <category.icon size={16} />
                <span>{category.label}</span>
              </button>
            ))}
          </div>

          {/* Exercise Card */}
          <div className="glass-card p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-indigo-500/15 border border-indigo-400/20 px-3 py-1 text-sm font-medium text-indigo-300">
                  {activeExercise.examType}
                </span>
                <span className="rounded-full bg-white/[0.06] border border-white/10 px-3 py-1 text-sm text-slate-300">
                  {activeExercise.level}
                </span>
                <span className="rounded-full bg-amber-500/15 border border-amber-400/20 px-3 py-1 text-sm text-amber-300">
                  {activeExercise.title}
                </span>
              </div>

              {phase !== "idle" && (
                <div className="inline-flex items-center gap-2 rounded-xl bg-white/[0.06] border border-white/10 px-3 py-1.5 text-sm font-semibold text-white">
                  <Clock3 size={15} className="text-indigo-400" />
                  {formatTime(timeLeft)}
                </div>
              )}
            </div>

            <p className="text-lg leading-relaxed text-slate-200">{activeExercise.question}</p>

            <div className="mt-5 flex flex-wrap items-center gap-3 text-sm text-slate-400">
              <span className="inline-flex items-center gap-1 rounded-lg bg-white/[0.04] border border-white/[0.06] px-2.5 py-1">
                <Clock3 size={14} /> Prep: {activeExercise.preparationTime}s
              </span>
              <span className="inline-flex items-center gap-1 rounded-lg bg-white/[0.04] border border-white/[0.06] px-2.5 py-1">
                <Mic size={14} /> Response: {activeExercise.responseTime}s
              </span>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              {phase === "idle" && (
                <button
                  onClick={startExercise}
                  className="btn-primary rounded-xl px-5 py-2.5 font-semibold text-white flex items-center gap-2"
                >
                  <span>Start Preparation</span>
                </button>
              )}

              {phase === "preparation" && (
                <div className="inline-flex items-center gap-2 rounded-xl bg-amber-500/10 border border-amber-400/20 px-4 py-2 text-amber-300">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-amber-400" />
                  Preparation in progress
                </div>
              )}

              {phase === "recording" && (
                <>
                  <button
                    onMouseDown={startRecording}
                    onMouseUp={stopRecording}
                    onMouseLeave={stopRecording}
                    disabled={isPlaying}
                    className={`flex items-center gap-2 rounded-xl px-4 py-2.5 font-semibold text-white transition-all duration-300 ${
                      isRecording
                        ? "bg-red-500/30 border border-red-400/30 text-red-300 shadow-lg shadow-red-500/20"
                        : isPlaying
                          ? "cursor-not-allowed bg-white/[0.04] border border-white/[0.06] text-slate-500"
                          : "bg-emerald-500/20 border border-emerald-400/30 text-emerald-300 hover:bg-emerald-500/30 hover:shadow-lg hover:shadow-emerald-500/10"
                    }`}
                  >
                    {isRecording ? <MicOff size={16} /> : <Mic size={16} />}
                    {isRecording ? "Recording" : "Hold to Speak"}
                  </button>

                  {isPlaying && (
                    <div className="inline-flex items-center gap-2 rounded-xl bg-indigo-500/10 border border-indigo-400/20 px-4 py-2 text-indigo-300">
                      <Volume2 size={16} className="animate-pulse" />
                      Examiner is speaking
                    </div>
                  )}

                  {!isPlaying && (
                    <span className="text-sm text-slate-500">
                      Press and hold to answer, release to send.
                    </span>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Live Transcript */}
          <div className="glass-card p-6">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-500">
              Live Transcript
            </h3>
            <div className="max-h-[340px] space-y-3 overflow-y-auto pr-1">
              {messages.length === 0 && (
                <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.02] p-4 text-sm text-slate-500">
                  Start an exercise to receive your first examiner prompt.
                </div>
              )}

              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[84%] rounded-2xl px-4 py-3 ${
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

                    {msg.pronunciation && (
                      <div className="mt-2 flex gap-2 text-xs">
                        <span className="rounded bg-indigo-500/15 border border-indigo-400/20 px-2 py-0.5 text-indigo-300">
                          Pronunciation: {msg.pronunciation.pronunciation_score}
                        </span>
                        <span className="rounded bg-emerald-500/15 border border-emerald-400/20 px-2 py-0.5 text-emerald-300">
                          Fluency: {msg.pronunciation.fluency_score}
                        </span>
                      </div>
                    )}

                    {msg.evaluation && (
                      <div className="mt-2 space-y-1 text-xs">
                        <div className="flex gap-2">
                          <span className="rounded bg-cyan-500/15 border border-cyan-400/20 px-2 py-0.5 text-cyan-300">
                            Grammar: {msg.evaluation.grammar_score}
                          </span>
                          <span className="rounded bg-amber-500/15 border border-amber-400/20 px-2 py-0.5 text-amber-300">
                            Vocabulary: {msg.evaluation.vocabulary_score}
                          </span>
                        </div>
                        {msg.evaluation.feedback && (
                          <p className="mt-1 italic text-slate-400">
                            {msg.evaluation.feedback}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}

              <div ref={messagesEndRef} />
            </div>
          </div>

          {error && (
            <div className="rounded-xl bg-red-500/10 border border-red-400/20 p-3 text-sm text-red-300">
              {error}
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-5 overflow-y-auto">
          {/* AI Evaluation */}
          <div className="glass-card p-6">
            <div className="mb-4 flex items-center gap-2">
              <Target size={16} className="text-indigo-400" />
              <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
                AI Evaluation
              </h3>
            </div>

            {!latestEvaluation ? (
              <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.02] p-4 text-sm text-slate-500">
                Complete one spoken response to see score details.
              </div>
            ) : (
              <>
                <div className="mb-4 flex items-end justify-between">
                  <p className="text-sm text-slate-400">Overall score</p>
                  <p className="text-3xl font-bold text-white">
                    {latestEvaluation.score}
                    <span className="text-lg text-slate-500">/100</span>
                  </p>
                </div>

                <ScoreRow label="Pronunciation" value={latestEvaluation.pronunciation} />
                <ScoreRow label="Grammar" value={latestEvaluation.grammar} />
                <ScoreRow label="Vocabulary" value={latestEvaluation.vocabulary} />
                <ScoreRow label="Coherence" value={latestEvaluation.coherence} />

                <div className="mt-4 rounded-xl bg-white/[0.04] border border-white/[0.06] p-3 text-sm text-slate-400">
                  {latestEvaluation.feedback}
                </div>
              </>
            )}
          </div>

          {/* Progress */}
          <div className="glass-card p-6">
            <div className="mb-4 flex items-center gap-2">
              <TrendingUp size={16} className="text-indigo-400" />
              <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
                Progress
              </h3>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <StatCard icon={<Target size={15} />} label="Responses" value={String(completedResponses)} />
              <StatCard
                icon={<TrendingUp size={15} />}
                label="Average"
                value={averageScore ? `${averageScore}/100` : "--"}
              />
              <StatCard
                icon={<Trophy size={15} />}
                label="Best"
                value={bestScore ? `${bestScore}/100` : "--"}
              />
              <StatCard icon={<Calendar size={15} />} label="Session" value={isDemo ? "Demo" : "Full"} />
            </div>

            {averageScore !== null && (
              <div className="mt-4 inline-flex items-center gap-2 rounded-xl bg-emerald-500/10 border border-emerald-400/20 px-3 py-2 text-sm text-emerald-300">
                <CheckCircle2 size={15} />
                You are trending upward. Keep consistent timing and transitions.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ScoreCard({
  label,
  score,
}: {
  label: string;
  score: number | null | undefined;
}) {
  const displayScore = score ?? "--";
  const color =
    score == null
      ? "text-slate-500"
      : score >= 80
        ? "text-emerald-400"
        : score >= 60
          ? "text-amber-400"
          : "text-red-400";

  return (
    <div className="glass-card p-4 text-center">
      <p className="text-sm text-slate-400">{label}</p>
      <p className={`text-3xl font-bold ${color}`}>{displayScore}</p>
    </div>
  );
}

function ScoreRow({ label, value }: { label: string; value: number | null }) {
  const safeValue = value ?? 0;
  const barColor =
    safeValue >= 80
      ? "bg-emerald-500"
      : safeValue >= 60
        ? "bg-amber-500"
        : "bg-red-500";
  const glowColor =
    safeValue >= 80
      ? "shadow-emerald-500/30"
      : safeValue >= 60
        ? "shadow-amber-500/30"
        : "shadow-red-500/30";

  return (
    <div className="mb-3">
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="text-slate-400">{label}</span>
        <span className="font-medium text-white">{value ?? "--"}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
        <div className={`h-full rounded-full ${barColor} shadow-sm ${glowColor} transition-all duration-500`} style={{ width: `${safeValue}%` }} />
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="glass-card p-3">
      <div className="mb-1 inline-flex rounded-lg bg-indigo-500/10 p-1.5 text-indigo-400">{icon}</div>
      <p className="text-lg font-bold text-white">{value}</p>
      <p className="text-xs text-slate-500">{label}</p>
    </div>
  );
}
