import base64
import json
import time
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.services.tts_service import text_to_speech_ssml
from app.services.stt_service import speech_to_text_with_pronunciation
from app.services.llm_service import get_conversation_response, evaluate_response
from app.services.db_service import get_user_session_balance, deduct_session, save_session_result

router = APIRouter()


@router.websocket("/ws/{user_id}")
async def session_websocket(websocket: WebSocket, user_id: str):
    """WebSocket endpoint for real-time speaking practice session.

    Protocol:
    1. Client connects with user_id
    2. Server sends initial examiner greeting (TTS audio)
    3. Client sends audio chunks (user speaking)
    4. Server processes: STT -> LLM -> TTS -> sends back audio + scores
    5. Loop until session ends
    """
    await websocket.accept()

    # Check session balance
    balance = await get_user_session_balance(user_id)
    if balance <= 0:
        await websocket.send_json({"type": "error", "message": "No sessions remaining"})
        await websocket.close()
        return

    # Deduct session
    if not await deduct_session(user_id):
        await websocket.send_json({"type": "error", "message": "Failed to deduct session"})
        await websocket.close()
        return

    # Session state
    conversation_history = []
    session_start = time.time()
    exam_part = 1
    level = "B1"
    session_scores = []

    try:
        # Wait for session config from client
        config_msg = await websocket.receive_json()
        if config_msg.get("type") == "config":
            exam_part = config_msg.get("exam_part", 1)
            level = config_msg.get("level", "B1")
            is_demo = config_msg.get("is_demo", False)

        # Generate initial examiner greeting
        greeting = await get_conversation_response(
            messages=[], exam_part=exam_part, level=level
        )
        conversation_history.append({"role": "assistant", "content": greeting})

        # Convert greeting to speech
        audio_data = await text_to_speech_ssml(greeting, rate="-10%")
        audio_b64 = base64.b64encode(audio_data).decode("utf-8")

        await websocket.send_json({
            "type": "examiner_audio",
            "audio": audio_b64,
            "text": greeting,
        })

        # Main conversation loop
        while True:
            message = await websocket.receive_json()

            if message["type"] == "user_audio":
                # Decode user audio
                audio_bytes = base64.b64decode(message["audio"])

                # STT + Pronunciation assessment
                stt_result = await speech_to_text_with_pronunciation(audio_bytes)

                if not stt_result["success"]:
                    await websocket.send_json({
                        "type": "stt_error",
                        "message": stt_result.get("error", "Could not understand audio"),
                    })
                    continue

                user_text = stt_result["text"]
                pronunciation = stt_result.get("pronunciation", {})

                # Send transcription back to client
                await websocket.send_json({
                    "type": "transcription",
                    "text": user_text,
                    "pronunciation": pronunciation,
                })

                # Add user message to history
                conversation_history.append({"role": "user", "content": user_text})

                # Evaluate response
                context = conversation_history[-2]["content"] if len(conversation_history) >= 2 else ""
                evaluation = await evaluate_response(user_text, context, level)

                # Track scores
                session_scores.append({
                    "pronunciation": pronunciation,
                    "evaluation": evaluation,
                })

                # Send evaluation to client
                await websocket.send_json({
                    "type": "evaluation",
                    "scores": evaluation,
                })

                # Generate examiner response
                examiner_response = await get_conversation_response(
                    messages=conversation_history, exam_part=exam_part, level=level
                )
                conversation_history.append({"role": "assistant", "content": examiner_response})

                # Convert to speech
                audio_data = await text_to_speech_ssml(examiner_response, rate="-10%")
                audio_b64 = base64.b64encode(audio_data).decode("utf-8")

                await websocket.send_json({
                    "type": "examiner_audio",
                    "audio": audio_b64,
                    "text": examiner_response,
                })

            elif message["type"] == "end_session":
                break

            elif message["type"] == "change_part":
                exam_part = message.get("exam_part", exam_part)
                await websocket.send_json({
                    "type": "part_changed",
                    "exam_part": exam_part,
                })

    except WebSocketDisconnect:
        pass
    finally:
        # Save session results
        duration = int(time.time() - session_start)
        avg_scores = _average_scores(session_scores)

        await save_session_result(user_id, {
            "exam_part": exam_part,
            "level": level,
            "duration_seconds": duration,
            "pronunciation_score": avg_scores.get("pronunciation_score"),
            "grammar_score": avg_scores.get("grammar_score"),
            "vocabulary_score": avg_scores.get("vocabulary_score"),
            "coherence_score": avg_scores.get("coherence_score"),
            "transcript": conversation_history,
        })

        # Send session summary
        try:
            await websocket.send_json({
                "type": "session_summary",
                "duration_seconds": duration,
                "scores": avg_scores,
                "exchanges": len([m for m in conversation_history if m["role"] == "user"]),
            })
        except Exception:
            pass


def _average_scores(scores: list[dict]) -> dict:
    """Calculate average scores across all exchanges in a session."""
    if not scores:
        return {}

    pron_scores = [
        s["pronunciation"].get("pronunciation_score", 0)
        for s in scores
        if s.get("pronunciation")
    ]
    grammar_scores = [
        s["evaluation"].get("grammar_score", 0)
        for s in scores
        if s.get("evaluation")
    ]
    vocab_scores = [
        s["evaluation"].get("vocabulary_score", 0)
        for s in scores
        if s.get("evaluation")
    ]
    coherence_scores = [
        s["evaluation"].get("coherence_score", 0)
        for s in scores
        if s.get("evaluation")
    ]

    def safe_avg(lst):
        return round(sum(lst) / len(lst), 1) if lst else None

    return {
        "pronunciation_score": safe_avg(pron_scores),
        "grammar_score": safe_avg(grammar_scores),
        "vocabulary_score": safe_avg(vocab_scores),
        "coherence_score": safe_avg(coherence_scores),
    }
