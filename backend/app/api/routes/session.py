import base64
import json
import time
import asyncio
import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.services.tts_service import text_to_speech_ssml
from app.services.stt_service import speech_to_text_with_pronunciation
from app.services.llm_service import get_conversation_response, evaluate_response, generate_session_review
from app.services.db_service import (
    get_user_session_balance, deduct_session, refund_session,
    save_session_result, is_session_active, set_session_active, clear_session_active,
)

router = APIRouter()
logger = logging.getLogger(__name__)

SESSION_TIMEOUT = 20 * 60  # 20 minutes max session
IDLE_TIMEOUT = 5 * 60      # 5 minutes no activity → auto-end


@router.websocket("/ws/{user_id}")
async def session_websocket(websocket: WebSocket, user_id: str):
    """WebSocket endpoint for real-time speaking practice session.

    Robust flow:
    1. Connect → balance check → prevent duplicate sessions
    2. Receive config → generate examiner greeting
    3. Conversation loop (STT → evaluate silently → LLM → TTS)
    4. Credit deducted only after first successful exchange
    5. On end: generate AI review → save → send summary → close
    6. On error: refund credit if zero exchanges, save partial if any
    """
    await websocket.accept()

    # ── Guard: duplicate session ──
    if is_session_active(user_id):
        await websocket.send_json({
            "type": "error",
            "message": "You already have an active session in another tab. Please close it first.",
        })
        await websocket.close()
        return

    # ── Guard: balance check ──
    balance = await get_user_session_balance(user_id)
    if balance <= 0:
        await websocket.send_json({"type": "error", "message": "No sessions remaining"})
        await websocket.close()
        return

    # Mark session active (prevent duplicate tabs)
    set_session_active(user_id)

    # Session state
    conversation_history: list[dict] = []
    session_start = time.time()
    exam_type = "tcf"
    exam_part = 1
    level = "B1"
    session_scores: list[dict] = []
    credit_deducted = False
    successful_exchanges = 0
    last_activity = time.time()

    try:
        # ── Config ──
        config_msg = await asyncio.wait_for(websocket.receive_json(), timeout=30)
        if config_msg.get("type") == "config":
            exam_type = config_msg.get("exam_type", "tcf")
            exam_part = config_msg.get("exam_part", 1)
            level = config_msg.get("level", "B1")

        # ── Greeting ──
        try:
            greeting = await get_conversation_response(
                messages=[], exam_type=exam_type, exam_part=exam_part, level=level
            )
        except Exception as e:
            logger.error(f"LLM greeting failed: {e}")
            await websocket.send_json({
                "type": "error",
                "message": "Failed to initialize examiner. Please try again.",
            })
            return

        conversation_history.append({"role": "assistant", "content": greeting})

        try:
            audio_data = await text_to_speech_ssml(greeting, rate="-10%")
            audio_b64 = base64.b64encode(audio_data).decode("utf-8")
        except Exception as e:
            logger.error(f"TTS greeting failed: {e}")
            # Send text-only fallback
            audio_b64 = ""

        await websocket.send_json({
            "type": "examiner_audio",
            "audio": audio_b64,
            "text": greeting,
        })

        # ── Conversation loop ──
        while True:
            # Check session timeout
            elapsed = time.time() - session_start
            if elapsed > SESSION_TIMEOUT:
                await websocket.send_json({
                    "type": "session_timeout",
                    "message": "Session time limit reached (20 minutes).",
                })
                break

            # Wait for message with idle timeout
            try:
                message = await asyncio.wait_for(
                    websocket.receive_json(),
                    timeout=IDLE_TIMEOUT,
                )
                last_activity = time.time()
            except asyncio.TimeoutError:
                await websocket.send_json({
                    "type": "session_timeout",
                    "message": "Session ended due to inactivity.",
                })
                break

            if message["type"] == "end_session":
                break

            elif message["type"] == "user_audio":
                audio_bytes = base64.b64decode(message["audio"])

                # ── STT ──
                try:
                    stt_result = await speech_to_text_with_pronunciation(audio_bytes)
                except Exception as e:
                    logger.error(f"STT crashed: {e}")
                    await websocket.send_json({
                        "type": "stt_error",
                        "message": "Speech processing failed. Please try again.",
                    })
                    continue

                if not stt_result["success"]:
                    await websocket.send_json({
                        "type": "stt_error",
                        "message": stt_result.get("error", "Could not understand audio. Please speak clearly and try again."),
                    })
                    continue

                user_text = stt_result["text"]
                pronunciation = stt_result.get("pronunciation", {})

                # Send transcription to client
                await websocket.send_json({
                    "type": "transcription",
                    "text": user_text,
                })

                conversation_history.append({"role": "user", "content": user_text})

                # ── Evaluate silently ──
                try:
                    context = conversation_history[-2]["content"] if len(conversation_history) >= 2 else ""
                    evaluation = await evaluate_response(user_text, context, level)
                    session_scores.append({
                        "pronunciation": pronunciation,
                        "evaluation": evaluation,
                    })
                except Exception as e:
                    logger.error(f"Evaluation failed: {e}")
                    # Non-critical — continue without score for this exchange

                # ── Deduct credit on first successful exchange ──
                if not credit_deducted:
                    credit_deducted = await deduct_session(user_id)
                    if not credit_deducted:
                        await websocket.send_json({
                            "type": "error",
                            "message": "Failed to deduct session credit.",
                        })
                        break

                successful_exchanges += 1

                # ── LLM response ──
                try:
                    examiner_response = await get_conversation_response(
                        messages=conversation_history, exam_type=exam_type, exam_part=exam_part, level=level
                    )
                except Exception as e:
                    logger.error(f"LLM response failed: {e}")
                    await websocket.send_json({
                        "type": "error",
                        "message": "Examiner response failed. Ending session to protect your data.",
                    })
                    break

                conversation_history.append({"role": "assistant", "content": examiner_response})

                # ── TTS ──
                try:
                    audio_data = await text_to_speech_ssml(examiner_response, rate="-10%")
                    audio_b64 = base64.b64encode(audio_data).decode("utf-8")
                except Exception as e:
                    logger.error(f"TTS failed: {e}")
                    audio_b64 = ""  # Send text-only fallback

                await websocket.send_json({
                    "type": "examiner_audio",
                    "audio": audio_b64,
                    "text": examiner_response,
                })

            elif message["type"] == "change_part":
                exam_part = message.get("exam_part", exam_part)
                conversation_history = []
                try:
                    greeting = await get_conversation_response(
                        messages=[], exam_type=exam_type, exam_part=exam_part, level=level
                    )
                    conversation_history.append({"role": "assistant", "content": greeting})
                    audio_data = await text_to_speech_ssml(greeting, rate="-10%")
                    audio_b64 = base64.b64encode(audio_data).decode("utf-8")
                except Exception as e:
                    logger.error(f"Part change failed: {e}")
                    audio_b64 = ""
                    greeting = "Passons à la partie suivante."
                    conversation_history.append({"role": "assistant", "content": greeting})

                await websocket.send_json({
                    "type": "part_changed",
                    "exam_part": exam_part,
                    "audio": audio_b64,
                    "text": greeting,
                })

    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected for user {user_id}")
    except Exception as e:
        logger.error(f"Unexpected session error for {user_id}: {e}")
    finally:
        # ── Cleanup: save results, refund if needed ──
        clear_session_active(user_id)
        duration = int(time.time() - session_start)

        if successful_exchanges == 0:
            # No real usage → refund credit if we deducted
            if credit_deducted:
                await refund_session(user_id)
            # Don't save empty sessions
            try:
                await websocket.send_json({
                    "type": "session_ended",
                    "message": "Session ended with no exchanges. Your credit has been preserved.",
                    "refunded": credit_deducted,
                })
            except Exception:
                pass
            return

        # ── Generate AI review (best-effort) ──
        avg_scores = _average_scores(session_scores)
        ai_review = None
        if conversation_history:
            try:
                ai_review = await generate_session_review(
                    conversation_history, exam_type=exam_type, level=level
                )
            except Exception as e:
                logger.error(f"Review generation failed for {user_id}: {e}")
                # Will be null — user can retry from dashboard

        # ── Save session ──
        try:
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
        except Exception as e:
            logger.error(f"Failed to save session for {user_id}: {e}")

        # ── Send summary to client ──
        try:
            await websocket.send_json({
                "type": "session_summary",
                "duration_seconds": duration,
                "scores": avg_scores,
                "exchanges": successful_exchanges,
                "ai_review": ai_review,
                "transcript": conversation_history,
            })
        except Exception:
            pass  # Client already disconnected


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
