import base64
import json
import time
import asyncio
import logging
from typing import Awaitable, TypeVar
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.services.tts_service import text_to_speech_ssml
from app.services.stt_service import speech_to_text_with_pronunciation
from app.services.llm_service import get_conversation_response, evaluate_response, generate_session_review
from app.services.db_service import (
    get_user_session_balance, deduct_session, refund_session,
    save_session_result, try_acquire_session_lock, release_session_lock,
    refresh_session_lock,
    has_demo_remaining, mark_demo_consumed, try_acquire_session_start_slot,
)
from app.core.config import settings

router = APIRouter()
logger = logging.getLogger(__name__)

SESSION_TIMEOUT = 20 * 60  # 20 minutes max session
DEMO_SESSION_TIMEOUT = 4 * 60  # 4 minutes max for free demo
IDLE_TIMEOUT = 5 * 60      # 5 minutes no activity → auto-end

# Step-level timeouts to prevent hanging in dependency calls.
STT_STEP_TIMEOUT = 20
EVAL_STEP_TIMEOUT = 12
LLM_STEP_TIMEOUT = 18
TTS_STEP_TIMEOUT = 15
REVIEW_STEP_TIMEOUT = 30

# In-process concurrency guards (Phase 1). For multi-instance global limits, add Redis/token-bucket.
STT_SEMAPHORE = asyncio.Semaphore(40)
EVAL_SEMAPHORE = asyncio.Semaphore(60)
LLM_SEMAPHORE = asyncio.Semaphore(50)
TTS_SEMAPHORE = asyncio.Semaphore(40)

T = TypeVar("T")


async def _run_step(coro: Awaitable[T], timeout_s: int, semaphore: asyncio.Semaphore) -> T:
    """Run a dependency call with timeout + bounded concurrency."""
    async with semaphore:
        return await asyncio.wait_for(coro, timeout=timeout_s)


async def _session_lock_heartbeat(user_id: str, owner_token: str) -> None:
    """Keep active-session lock alive while websocket is running."""
    interval = max(5, int(settings.session_lock_heartbeat_seconds))
    while True:
        await asyncio.sleep(interval)
        ok = refresh_session_lock(user_id, owner_token)
        if not ok:
            logger.warning(f"Session lock heartbeat failed for user {user_id}")


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

    # ── Guard: duplicate session (atomic lock) ──
    lock_owner_token = try_acquire_session_lock(user_id)
    if not lock_owner_token:
        logger.warning(f"Duplicate session blocked for user {user_id}")
        await websocket.send_json({
            "type": "error",
            "message": "You already have an active session in another tab. Please close it first.",
        })
        await websocket.close()
        return

    heartbeat_task = asyncio.create_task(_session_lock_heartbeat(user_id, lock_owner_token))

    # Session state
    conversation_history: list[dict] = []
    session_start = time.time()
    exam_type = "tcf"
    exam_part = 1
    level = "B1"
    is_demo = False
    session_scores: list[dict] = []
    credit_deducted = False
    successful_exchanges = 0
    last_activity = time.time()

    try:
        # ── Guard: rapid reconnect/start storms per user ──
        if not try_acquire_session_start_slot(user_id):
            logger.warning(f"Session start throttled for user {user_id}")
            await websocket.send_json({
                "type": "error",
                "message": "You're starting sessions too quickly. Please wait a few seconds and try again.",
            })
            return

        # ── Config ──
        config_msg = await asyncio.wait_for(websocket.receive_json(), timeout=30)
        if config_msg.get("type") == "config":
            exam_type = config_msg.get("exam_type", "tcf")
            exam_part = config_msg.get("exam_part", 1)
            level = config_msg.get("level", "B1")
            is_demo = bool(config_msg.get("is_demo", False))

        # ── Guard: demo or paid balance check ──
        if is_demo:
            if not await has_demo_remaining(user_id):
                logger.warning(f"Demo already consumed for user {user_id}")
                await websocket.send_json({
                    "type": "error",
                    "message": "Demo already consumed. Please purchase a session pack to continue.",
                })
                await websocket.close()
                return
        else:
            balance = await get_user_session_balance(user_id)
            if balance <= 0:
                logger.warning(f"No sessions remaining for user {user_id}")
                await websocket.send_json({"type": "error", "message": "No sessions remaining"})
                await websocket.close()
                return

        logger.info(
            f"Session started for user {user_id} "
            f"(mode={'demo' if is_demo else 'paid'})"
        )
        session_timeout = DEMO_SESSION_TIMEOUT if is_demo else SESSION_TIMEOUT

        # ── Greeting ──
        try:
            greeting = await _run_step(
                get_conversation_response(
                    messages=[], exam_type=exam_type, exam_part=exam_part, level=level
                ),
                LLM_STEP_TIMEOUT,
                LLM_SEMAPHORE,
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
            audio_data = await _run_step(
                text_to_speech_ssml(greeting, rate="-10%"),
                TTS_STEP_TIMEOUT,
                TTS_SEMAPHORE,
            )
            audio_b64 = base64.b64encode(audio_data).decode("utf-8")
        except Exception as e:
            logger.error(f"TTS greeting failed: {e}")
            # Send text-only fallback
            audio_b64 = ""

        await websocket.send_json({
            "type": "examiner_audio",
            "audio": audio_b64,
            "audio_fallback": audio_b64 == "",
            "text": greeting,
        })

        # ── Conversation loop ──
        while True:
            # Check session timeout
            elapsed = time.time() - session_start
            if elapsed > session_timeout:
                await websocket.send_json({
                    "type": "session_timeout",
                    "message": "Demo time limit reached (4 minutes)." if is_demo else "Session time limit reached (20 minutes).",
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
                    stt_result = await _run_step(
                        speech_to_text_with_pronunciation(audio_bytes),
                        STT_STEP_TIMEOUT,
                        STT_SEMAPHORE,
                    )
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
                    evaluation = await _run_step(
                        evaluate_response(user_text, context, level),
                        EVAL_STEP_TIMEOUT,
                        EVAL_SEMAPHORE,
                    )
                    session_scores.append({
                        "pronunciation": pronunciation,
                        "evaluation": evaluation,
                    })
                except Exception as e:
                    logger.error(f"Evaluation failed: {e}")
                    # Non-critical — continue without score for this exchange

                # ── Deduct credit on first successful exchange ──
                if not is_demo and not credit_deducted:
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
                    examiner_response = await _run_step(
                        get_conversation_response(
                            messages=conversation_history, exam_type=exam_type, exam_part=exam_part, level=level
                        ),
                        LLM_STEP_TIMEOUT,
                        LLM_SEMAPHORE,
                    )
                except Exception as e:
                    logger.error(f"LLM response failed: {e}")
                    examiner_response = (
                        "Je rencontre un petit délai technique. "
                        "Reprenons avec une nouvelle réponse, s'il vous plaît."
                    )

                conversation_history.append({"role": "assistant", "content": examiner_response})

                # ── TTS ──
                try:
                    audio_data = await _run_step(
                        text_to_speech_ssml(examiner_response, rate="-10%"),
                        TTS_STEP_TIMEOUT,
                        TTS_SEMAPHORE,
                    )
                    audio_b64 = base64.b64encode(audio_data).decode("utf-8")
                except Exception as e:
                    logger.error(f"TTS failed: {e}")
                    audio_b64 = ""  # Send text-only fallback

                await websocket.send_json({
                    "type": "examiner_audio",
                    "audio": audio_b64,
                    "audio_fallback": audio_b64 == "",
                    "text": examiner_response,
                })

            elif message["type"] == "change_part":
                exam_part = message.get("exam_part", exam_part)
                conversation_history = []
                try:
                    greeting = await _run_step(
                        get_conversation_response(
                            messages=[], exam_type=exam_type, exam_part=exam_part, level=level
                        ),
                        LLM_STEP_TIMEOUT,
                        LLM_SEMAPHORE,
                    )
                    conversation_history.append({"role": "assistant", "content": greeting})
                    audio_data = await _run_step(
                        text_to_speech_ssml(greeting, rate="-10%"),
                        TTS_STEP_TIMEOUT,
                        TTS_SEMAPHORE,
                    )
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
                    "audio_fallback": audio_b64 == "",
                    "text": greeting,
                })

    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected for user {user_id}")
    except Exception as e:
        logger.error(f"Unexpected session error for {user_id}: {e}")
    finally:
        # ── Cleanup: save results, refund if needed ──
        if heartbeat_task:
            heartbeat_task.cancel()
            try:
                await heartbeat_task
            except asyncio.CancelledError:
                pass
        release_session_lock(user_id, lock_owner_token)
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
        else:
            # ── Generate AI review (best-effort) ──
            avg_scores = _average_scores(session_scores)
            corrections = _collect_corrections(session_scores)
            ai_review = None

            if is_demo:
                try:
                    await mark_demo_consumed(user_id)
                except Exception as e:
                    logger.error(f"Failed to mark demo consumed for {user_id}: {e}")

            if conversation_history:
                try:
                    ai_review = await _run_step(
                        generate_session_review(
                            conversation_history, exam_type=exam_type, level=level
                        ),
                        REVIEW_STEP_TIMEOUT,
                        LLM_SEMAPHORE,
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
                    "is_demo": is_demo,
                    "duration_seconds": duration,
                    "pronunciation_score": avg_scores.get("pronunciation_score"),
                    "grammar_score": avg_scores.get("grammar_score"),
                    "vocabulary_score": avg_scores.get("vocabulary_score"),
                    "coherence_score": avg_scores.get("coherence_score"),
                    "corrections": corrections,
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
                    "is_demo": is_demo,
                    "ai_review": ai_review,
                    "transcript": conversation_history,
                })
            except Exception:
                pass  # Client already disconnected


@router.get("/demo-status/{user_id}")
async def get_demo_status(user_id: str):
    """Return whether user still has the free demo available."""
    remaining = await has_demo_remaining(user_id)
    return {
        "user_id": user_id,
        "demo_remaining": remaining,
        "demo_used": not remaining,
    }


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


def _collect_corrections(scores: list[dict]) -> list[dict]:
    """Collect all corrections from evaluations across exchanges."""
    corrections = []
    for s in scores:
        ev = s.get("evaluation", {})
        for c in ev.get("corrections", []):
            if isinstance(c, str):
                corrections.append({"text": c})
            elif isinstance(c, dict):
                corrections.append(c)
        fb = ev.get("feedback")
        if fb and fb != "Évaluation non disponible.":
            corrections.append({"feedback": fb})
    return corrections
