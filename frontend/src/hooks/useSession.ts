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
}

interface UseSessionOptions {
  userId: string;
  examPart?: number;
  level?: string;
  isDemo?: boolean;
  onMessage?: (msg: SessionMessage) => void;
  onError?: (error: string) => void;
  onClose?: () => void;
}

export function useSession({
  userId,
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
      // Send session config
      ws.send(
        JSON.stringify({
          type: "config",
          exam_part: examPart,
          level: level,
          is_demo: isDemo,
        })
      );
    };

    ws.onmessage = (event) => {
      const msg: SessionMessage = JSON.parse(event.data);

      if (msg.type === "error") {
        onError?.(msg.message || "Unknown error");
        return;
      }

      onMessage?.(msg);
    };

    ws.onclose = () => {
      setIsConnected(false);
      onClose?.();
    };

    ws.onerror = () => {
      onError?.("WebSocket connection error");
      setIsConnected(false);
    };

    wsRef.current = ws;
  }, [userId, examPart, level, isDemo, onMessage, onError, onClose]);

  const disconnect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "end_session" }));
      wsRef.current.close();
    }
    setIsConnected(false);
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
        const audioBlob = new Blob(audioChunksRef.current, {
          type: "audio/webm",
        });
        const arrayBuffer = await audioBlob.arrayBuffer();
        const base64Audio = btoa(
          String.fromCharCode(...new Uint8Array(arrayBuffer))
        );

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

  return {
    connect,
    disconnect,
    startRecording,
    stopRecording,
    changePart,
    isConnected,
    isRecording,
  };
}
