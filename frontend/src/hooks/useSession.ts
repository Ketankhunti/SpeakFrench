"use client";

import { useRef, useState, useCallback } from "react";

export interface SessionMessage {
  type: string;
  audio?: string;
  text?: string;
  pronunciation?: {
    accuracy_score: number;
    fluency_score: number;
    completeness_score: number;
    pronunciation_score: number;
  };
  scores?: {
    pronunciation_score: number;
    grammar_score: number;
    vocabulary_score: number;
    coherence_score: number;
    corrections: string[];
    feedback: string;
  };
  message?: string;
  duration_seconds?: number;
  exchanges?: number;
  ai_review?: string;
  transcript?: { role: string; content: string }[];
  exam_part?: number;
}

interface UseSessionOptions {
  userId: string;
  examType?: string;
  examPart?: number;
  level?: string;
  isDemo?: boolean;
  onMessage?: (msg: SessionMessage) => void;
  onError?: (error: string) => void;
  onClose?: () => void;
}

export function useSession({
  userId,
  examType = "tcf",
  examPart = 1,
  level = "B1",
  isDemo = false,
  onMessage,
  onError,
  onClose,
}: UseSessionOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const suppressOnCloseRef = useRef(false);
  const endingRef = useRef(false);
  const gotServerErrorRef = useRef(false);

  const connect = useCallback(() => {
    if (
      wsRef.current &&
      (wsRef.current.readyState === WebSocket.OPEN ||
        wsRef.current.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    const wsUrl = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8000";
    const ws = new WebSocket(`${wsUrl}/api/session/ws/${userId}`);

    ws.onopen = () => {
      setIsConnected(true);
      gotServerErrorRef.current = false;
      // Send session config with exam type
      ws.send(
        JSON.stringify({
          type: "config",
          exam_type: examType,
          exam_part: examPart,
          level: level,
          is_demo: isDemo,
        })
      );
    };

    ws.onmessage = (event) => {
      const msg: SessionMessage = JSON.parse(event.data);

      if (msg.type === "error") {
        gotServerErrorRef.current = true;
        onError?.(msg.message || "Unknown error");
        return;
      }

      onMessage?.(msg);
    };

    ws.onclose = () => {
      setIsConnected(false);
      if (!suppressOnCloseRef.current) {
        onClose?.();
      }
      suppressOnCloseRef.current = false;
      endingRef.current = false;
    };

    ws.onerror = () => {
      // Suppress generic WS error if we already got a specific error from the server
      // or if the connection was never established (transient reconnect)
      if (!gotServerErrorRef.current && !suppressOnCloseRef.current) {
        onError?.("WebSocket connection error");
      }
      setIsConnected(false);
    };

    wsRef.current = ws;
  }, [userId, examType, examPart, level, isDemo, onMessage, onError, onClose]);

  const disconnect = useCallback(() => {
    endingRef.current = true;
    suppressOnCloseRef.current = true;

    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      // Send end_session — DON'T close yet, wait for server to send summary
      wsRef.current.send(JSON.stringify({ type: "end_session" }));
      // Server will send session_summary then we close in onmessage or after timeout
      const ws = wsRef.current;
      setTimeout(() => {
        // Safety: force close if server doesn't respond within 15s
        if (ws.readyState === WebSocket.OPEN) {
          ws.close();
        }
      }, 15000);
    } else {
      setIsConnected(false);
      suppressOnCloseRef.current = false;
    }
  }, []);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: "audio/webm;codecs=opus",
      });

      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        if (endingRef.current) {
          // Session is ending; discard captured audio and just cleanup tracks.
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        const audioBlob = new Blob(audioChunksRef.current, {
          type: "audio/webm",
        });
        // Convert blob to base64 using FileReader (avoids stack overflow with large arrays)
        const base64Audio = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const dataUrl = reader.result as string;
            // Strip the "data:audio/webm;base64," prefix
            resolve(dataUrl.split(",")[1] || "");
          };
          reader.onerror = reject;
          reader.readAsDataURL(audioBlob);
        });

        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(
            JSON.stringify({
              type: "user_audio",
              audio: base64Audio,
            })
          );
        }

        // Stop all tracks
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorder.start();
      mediaRecorderRef.current = mediaRecorder;
      setIsRecording(true);
    } catch {
      onError?.("Microphone access denied");
    }
  }, [onError]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  }, []);

  const changePart = useCallback(
    (part: number) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({ type: "change_part", exam_part: part })
        );
      }
    },
    []
  );

  // Force-close WS without waiting for summary (for unmount cleanup)
  const cleanup = useCallback(() => {
    if (wsRef.current) {
      suppressOnCloseRef.current = true;
      gotServerErrorRef.current = true; // suppress any onerror from this cleanup
      wsRef.current.onclose = null; // prevent onClose callback from firing
      wsRef.current.onerror = null; // prevent onerror from firing
      if (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING) {
        wsRef.current.close();
      }
      wsRef.current = null;
    }
    endingRef.current = false;
    suppressOnCloseRef.current = false;
    setIsConnected(false);
  }, []);

  return {
    connect,
    disconnect,
    cleanup,
    startRecording,
    stopRecording,
    changePart,
    isConnected,
    isRecording,
  };
}
