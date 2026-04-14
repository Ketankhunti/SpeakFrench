import base64
import json
import time
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.services.tts_service import text_to_speech_ssml
from app.services.stt_service import speech_to_text_with_pronunciation
from app.services.llm_service import get_conversation_response, evaluate_response, generate_session_review
from app.services.db_service import get_user_session_balance, deduct_session, save_session_result

router = APIRouter()


@router.websocket("/ws/{user_id}")
async def session_websocket(websocket: WebSocket, user_id: str):
    """WebSocket endpoint for real-time speaking practice session.

    Protocol:
    1. Client connects with user_id
    2. Client sends config (exam_type, exam_part, level)
    3. Server sends initial examiner greeting (TTS audio)
    4. Client sends audio (user speaking)
    5. Server processes: STT -> LLM -> TTS -> sends back examiner audio + transcription
    6. No live evaluation/scores — comprehensive review only at session end
    7. Loop until session ends
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
    exam_type = "tcf"
    exam_part = 1
    level = "B1"
    session_scores = []

    try:
        # Wait for session config from client
        config_msg = await websocket.receive_json()
        if config_msg.get("type") == "config":
            exam_type = config_msg.get("exam_type", "tcf")
            exam_part = config_msg.get("exam_part", 1)
            level = config_msg.get("level", "B1")

        # Generate initial examiner greeting
        greeting = await get_conversation_response(
            messages=[], exam_type=exam_type, exam_part=exam_part, level=level
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

                # Send transcription back to client (no scores — just text)
                await websocket.send_json({
                    "type": "transcription",
                    "text": user_text,
                })

                # Add user message to history
                conversation_history.append({"role": "user", "content": user_text})

                # Evaluate response silently (stored for end-of-session review)
                context = conversation_history[-2]["content"] if len(conversation_history) >= 2 else ""
                evaluation = await evaluate_response(user_text, context, level)

                # Track scores internally — NOT sent to client during session
                session_scores.append({
                    "pronunciation": pronunciation,
                    "evaluation": evaluation,
                })

                # Generate examiner response
                examiner_response = await get_conversation_response(
                    messages=conversation_history, exam_type=exam_type, exam_part=exam_part, level=level
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
                conversation_history = []
                # Generate new greeting for the new part
                greeting = await get_conversation_response(
                    messages=[], exam_type=exam_type, exam_part=exam_part, level=level
                )
                conversation_history.append({"role": "assistant", "content": greeting})
                audio_data = await text_to_speech_ssml(greeting, rate="-10%")
                audio_b64 = base64.b64encode(audio_data).decode("utf-8")
                await websocket.send_json({
                    "type": "part_changed",
                    "exam_part": exam_part,
                    "audio": audio_b64,
                    "text": greeting,
                })

    except WebSocketDisconnect:
        pass
    finally:
        # Calculate average scores
        duration = int(time.time() - session_start)
        avg_scores = _average_scores(session_scores)

        # Generate comprehensive AI review
        ai_review = None
        if conversation_history:
            try:
                ai_review = await generate_session_review(
                    conversation_history, exam_type=exam_type, level=level
                )
            except Exception:
                ai_review = "Review generation failed. Please check your session transcript."

        # Save session results with review
        await save_session_result(user_id, {
            "exam_type": exam_type,
            "exam_part": exam_part,
            "level": level,
            "duration_seconds": duration,
            "pronunciation_score": avg_scores.get("pronunciation_score"),
            "grammar_score": avg_scores.get("grammar_score"),
            "vocabulary_score": avg_scores.get("vocabulary_score"),
            "coherence_score": avg_scores.get("coherence_score"),
            "transcript": conversation_history,
            "ai_review": ai_review,
        })

        # Send comprehensive session summary to client
        try:
            await websocket.send_json({
                "type": "session_summary",
                "duration_seconds": duration,
                "scores": avg_scores,
                "exchanges": len([m for m in conversation_history if m["role"] == "user"]),
                "ai_review": ai_review,
                "transcript": conversation_history,
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
