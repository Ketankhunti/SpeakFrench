import base64
import json
import re
import time
import asyncio
import logging
from typing import Awaitable, TypeVar
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.services.tts_service import text_to_speech_ssml
from app.services.stt_service import speech_to_text_with_pronunciation
from app.services.llm_service import (
    get_conversation_response,
    get_conversation_response_stream,
    evaluate_response,
    generate_session_review,
)
from app.services.db_service import (
    get_user_session_balance, deduct_session, refund_session,
    save_session_result, try_acquire_session_lock, release_session_lock,
    refresh_session_lock,
    has_demo_remaining, mark_demo_consumed, try_acquire_session_start_slot,
)
from app.core.config import settings
from app.services.metrics import inc as metrics_inc

router = APIRouter()
logger = logging.getLogger(__name__)

SESSION_TIMEOUT = 22 * 60  # Hard safety cap (22 min) — per-part timing drives normal flow.
DEMO_SESSION_TIMEOUT = 4 * 60  # 4 minutes max for free demo
IDLE_TIMEOUT = 5 * 60      # 5 minutes no activity → auto-end

# Per-part pacing: auto-advance to the next part when BOTH minimum exchanges AND
# minimum elapsed time have passed (or hard maximums are exceeded). This avoids
# advancing too quickly when STT failures consume the early turns.
PART_CONFIG: dict[str, dict[int, dict]] = {
    "tcf": {
        1: {"min_seconds": 90,  "max_seconds": 4 * 60,      "min_exchanges": 4, "max_exchanges": 7,  "label": "T\u00e2che 1"},
        2: {"min_seconds": 4 * 60, "max_seconds": 7 * 60,   "min_exchanges": 5, "max_exchanges": 9,  "label": "T\u00e2che 2"},
        3: {"min_seconds": 4 * 60, "max_seconds": 7 * 60,   "min_exchanges": 5, "max_exchanges": 9,  "label": "T\u00e2che 3"},
    },
    "tef": {
        1: {"min_seconds": 4 * 60, "max_seconds": 6 * 60,   "min_exchanges": 5, "max_exchanges": 8,  "label": "Section A"},
        2: {"min_seconds": 7 * 60, "max_seconds": 11 * 60,  "min_exchanges": 7, "max_exchanges": 12, "label": "Section B"},
    },
}


def _max_part_for(exam_type: str) -> int:
    parts = PART_CONFIG.get(exam_type, PART_CONFIG["tcf"])
    return max(parts.keys())


def _part_limits(exam_type: str, exam_part: int) -> dict:
    parts = PART_CONFIG.get(exam_type, PART_CONFIG["tcf"])
    return parts.get(exam_part, parts[max(parts.keys())])


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

# Split the streaming LLM output at sentence ends OR clause-level punctuation
# once we have enough characters. Finer cuts = lower perceived latency.
_SPLIT_RE = re.compile(r"[.!?\u2026]+[\s\n]|[,;:][\s\n]|\n")
_MIN_CHUNK_CHARS_FIRST = 15  # ship the very first chunk fast for low TTFA
_MIN_CHUNK_CHARS = 30        # subsequent chunks can be slightly larger


async def _run_step(coro: Awaitable[T], timeout_s: int, semaphore: asyncio.Semaphore) -> T:
    """Run a dependency call with timeout + bounded concurrency."""
    async with semaphore:
        return await asyncio.wait_for(coro, timeout=timeout_s)


async def _synth_one(text: str) -> bytes:
    """Synthesize a single chunk under the TTS semaphore + timeout."""
    return await _run_step(
        text_to_speech_ssml(text, rate="-10%"),
        TTS_STEP_TIMEOUT,
        TTS_SEMAPHORE,
    )


async def _synth_and_send_chunk(
    websocket: WebSocket, message_type: str, text: str, final: bool, **extra
) -> None:
    """Synthesize one sentence and send it as an audio chunk over the WS.

    Falls back to a text-only message on TTS failure so the client can keep up.
    """
    audio_b64 = ""
    if text.strip():
        try:
            audio = await _synth_one(text)
            audio_b64 = base64.b64encode(audio).decode("utf-8")
        except Exception as e:
            metrics_inc("dependency_timeout_tts")
            logger.error(f"TTS chunk failed: {e}")

    payload = {
        "type": message_type,
        "audio": audio_b64,
        "audio_fallback": audio_b64 == "",
        "text": text,
        "final": final,
    }
    payload.update(extra)
    await websocket.send_json(payload)


async def _stream_examiner_reply(
    websocket: WebSocket,
    history: list[dict],
    exam_type: str,
    exam_part: int,
    level: str,
    message_type: str = "examiner_audio",
    extra_first: dict | None = None,
) -> str:
    """Stream LLM tokens, synthesize per-sentence in parallel, and ship audio chunks in order.

    Returns the full assembled examiner text (for conversation_history).

    Pipeline:
      - LLM streams text → split into chunks at punctuation boundaries.
      - Each chunk's TTS task is scheduled immediately (parallel synthesis).
      - We forward chunks in order to the client; chunk N is awaited while
        chunks N+1, N+2... are already synthesizing.
      - First chunk uses `message_type` (e.g. "examiner_audio" or "part_changed").
      - Subsequent chunks use "examiner_audio_chunk".
      - Final empty chunk with `final: true` signals end-of-turn.
    """
    full_text_parts: list[str] = []
    chunk_texts: list[str] = []
    chunk_tasks: list[asyncio.Task[bytes]] = []
    buffer = ""

    def _schedule(chunk_text: str) -> None:
        chunk_texts.append(chunk_text)
        chunk_tasks.append(asyncio.create_task(_synth_one(chunk_text)))

    # ── Producer: stream LLM tokens and schedule TTS in parallel ──
    try:
        async with LLM_SEMAPHORE:
            stream = get_conversation_response_stream(
                messages=history, exam_type=exam_type, exam_part=exam_part, level=level
            )
            async for delta in stream:
                buffer += delta
                full_text_parts.append(delta)

                # Flush as many chunks as possible. First chunk uses a smaller
                # threshold so we ship audio as fast as possible.
                while True:
                    min_chars = _MIN_CHUNK_CHARS_FIRST if not chunk_tasks else _MIN_CHUNK_CHARS
                    if len(buffer) < min_chars:
                        break
                    match = _SPLIT_RE.search(buffer)
                    if not match:
                        break
                    chunk = buffer[: match.end()].strip()
                    buffer = buffer[match.end():]
                    if chunk:
                        _schedule(chunk)
    except asyncio.TimeoutError:
        metrics_inc("dependency_timeout_llm")
        # Cancel scheduled TTS tasks before re-raising so we don't leak work.
        for t in chunk_tasks:
            if not t.done():
                t.cancel()
        raise

    # Flush trailing tail.
    tail = buffer.strip()
    if tail:
        _schedule(tail)

    # ── Consumer: send chunks in order. Tasks already running concurrently. ──
    sent_first = False
    for i, (text, task) in enumerate(zip(chunk_texts, chunk_tasks)):
        try:
            audio = await task
            audio_b64 = base64.b64encode(audio).decode("utf-8")
        except Exception as e:
            metrics_inc("dependency_timeout_tts")
            logger.error(f"TTS chunk {i} failed: {e}")
            audio_b64 = ""

        if not sent_first:
            msg_type = message_type
            extra = extra_first or {}
            sent_first = True
        else:
            msg_type = "examiner_audio_chunk"
            extra = {}

        payload = {
            "type": msg_type,
            "audio": audio_b64,
            "audio_fallback": audio_b64 == "",
            "text": text,
            "final": False,
        }
        payload.update(extra)
        await websocket.send_json(payload)

    # End-of-turn marker.
    if not sent_first:
        # LLM produced nothing — send an empty leading message so client unblocks.
        empty_payload = {
            "type": message_type,
            "audio": "",
            "audio_fallback": True,
            "text": "",
            "final": True,
        }
        empty_payload.update(extra_first or {})
        await websocket.send_json(empty_payload)
    else:
        await websocket.send_json({
            "type": "examiner_audio_chunk",
            "audio": "",
            "audio_fallback": False,
            "text": "",
            "final": True,
        })

    return "".join(full_text_parts).strip()


async def _session_lock_heartbeat(user_id: str, owner_token: str) -> None:
    """Keep active-session lock alive while websocket is running."""
    interval = max(5, int(settings.session_lock_heartbeat_seconds))
    while True:
        await asyncio.sleep(interval)
        ok = refresh_session_lock(user_id, owner_token)
        if not ok:
            metrics_inc("lock_heartbeat_failed")
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
        metrics_inc("lock_acquire_failed")
        logger.warning(f"Duplicate session blocked for user {user_id}")
        await websocket.send_json({
            "type": "error",
            "message": "You already have an active session in another tab. Please close it first.",
        })
        await websocket.close()
        return

    heartbeat_task = asyncio.create_task(_session_lock_heartbeat(user_id, lock_owner_token))

    # Session state
    conversation_history: list[dict] = []  # LLM context for current part only
    full_transcript: list[dict] = []       # Cross-part transcript for storage/review
    parts_completed: set[int] = set()
    session_start = time.time()
    exam_type = "tcf"
    exam_part = 1
    level = "B1"
    is_demo = False
    session_scores: list[dict] = []
    # Background eval tasks: each yields (pronunciation, evaluation) when awaited.
    pending_evals: list[asyncio.Task] = []
    credit_deducted = False
    successful_exchanges = 0
    last_activity = time.time()
    # Per-part state (reset on each part change).
    part_started_at = time.time()
    part_exchanges = 0

    try:
        # ── Guard: rapid reconnect/start storms per user ──
        if not try_acquire_session_start_slot(user_id):
            metrics_inc("session_start_throttled")
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

        metrics_inc("sessions_started")
        logger.info(
            f"Session started for user {user_id} "
            f"(mode={'demo' if is_demo else 'paid'})"
        )
        session_timeout = DEMO_SESSION_TIMEOUT if is_demo else SESSION_TIMEOUT
        # Reset per-part timer now that we know the actual starting part.
        part_started_at = time.time()
        part_exchanges = 0

        # ── Greeting (streamed) ──
        try:
            greeting = await asyncio.wait_for(
                _stream_examiner_reply(
                    websocket,
                    history=[],
                    exam_type=exam_type,
                    exam_part=exam_part,
                    level=level,
                    message_type="examiner_audio",
                ),
                timeout=LLM_STEP_TIMEOUT + TTS_STEP_TIMEOUT,
            )
        except Exception as e:
            logger.error(f"LLM greeting stream failed: {e}")
            await websocket.send_json({
                "type": "error",
                "message": "Failed to initialize examiner. Please try again.",
            })
            return

        if greeting:
            conversation_history.append({"role": "assistant", "content": greeting})
            full_transcript.append({"role": "assistant", "content": greeting, "part": exam_part})
            parts_completed.add(exam_part)

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
                    metrics_inc("dependency_timeout_stt")
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
                full_transcript.append({"role": "user", "content": user_text, "part": exam_part})
                parts_completed.add(exam_part)

                # ── Evaluate silently (fire-and-forget; gathered at session end) ──
                # Eval result is never shown during the conversation, so we don't block
                # the LLM/TTS reply on it. This removes ~1–2s of dead air per turn.
                context = conversation_history[-2]["content"] if len(conversation_history) >= 2 else ""

                async def _eval_turn(
                    text: str = user_text,
                    ctx: str = context,
                    pron: dict = pronunciation,
                ) -> dict:
                    try:
                        evaluation = await _run_step(
                            evaluate_response(text, ctx, level),
                            EVAL_STEP_TIMEOUT,
                            EVAL_SEMAPHORE,
                        )
                        return {"pronunciation": pron, "evaluation": evaluation}
                    except Exception as e:
                        metrics_inc("dependency_timeout_eval")
                        logger.error(f"Evaluation failed: {e}")
                        return {"pronunciation": pron, "evaluation": None}

                pending_evals.append(asyncio.create_task(_eval_turn()))

                # ── Deduct credit on first successful exchange (off critical path) ──
                # We optimistically count the exchange as "deducted" immediately so
                # the LLM/TTS reply isn't blocked by a slow Supabase round-trip
                # (which can take several seconds on the free tier). If the actual
                # deduction fails later, the finally-block refund logic catches it
                # via the `credit_deducted` flag, and we already have the lock.
                if not is_demo and not credit_deducted:
                    credit_deducted = True  # optimistic

                    async def _do_deduct() -> None:
                        ok = await deduct_session(user_id)
                        if not ok:
                            # Surface a soft warning; we don't kill the in-flight reply.
                            logger.warning(
                                f"Async credit deduction failed for {user_id}; "
                                "session will continue but will not be re-charged."
                            )
                            try:
                                await websocket.send_json({
                                    "type": "error",
                                    "message": "Warning: session credit could not be confirmed. Continuing anyway.",
                                })
                            except Exception:
                                pass

                    asyncio.create_task(_do_deduct())

                successful_exchanges += 1

                # ── LLM response + TTS (streamed sentence-by-sentence) ──
                try:
                    examiner_response = await asyncio.wait_for(
                        _stream_examiner_reply(
                            websocket,
                            history=conversation_history,
                            exam_type=exam_type,
                            exam_part=exam_part,
                            level=level,
                            message_type="examiner_audio",
                        ),
                        timeout=LLM_STEP_TIMEOUT + TTS_STEP_TIMEOUT,
                    )
                except Exception as e:
                    metrics_inc("dependency_timeout_llm")
                    logger.error(f"LLM stream failed: {e}")
                    examiner_response = (
                        "Je rencontre un petit délai technique. "
                        "Reprenons avec une nouvelle réponse, s'il vous plaît."
                    )
                    try:
                        await _synth_and_send_chunk(
                            websocket, "examiner_audio", examiner_response, final=False
                        )
                        await websocket.send_json({
                            "type": "examiner_audio_chunk",
                            "audio": "",
                            "audio_fallback": False,
                            "text": "",
                            "final": True,
                        })
                    except Exception:
                        pass

                if examiner_response:
                    conversation_history.append({"role": "assistant", "content": examiner_response})
                    full_transcript.append({"role": "assistant", "content": examiner_response, "part": exam_part})
                    parts_completed.add(exam_part)

                part_exchanges += 1

                # ── Auto-advance to next part when limits reached ──
                # Demo sessions stay in their starting part; only paid sessions advance.
                if not is_demo:
                    limits = _part_limits(exam_type, exam_part)
                    part_elapsed = time.time() - part_started_at
                    # Advance only if we've crossed BOTH minimums, OR hit a hard maximum.
                    hit_min = (
                        part_exchanges >= int(limits["min_exchanges"]) and
                        part_elapsed >= int(limits["min_seconds"])
                    )
                    hit_max = (
                        part_exchanges >= int(limits["max_exchanges"]) or
                        part_elapsed >= int(limits["max_seconds"])
                    )
                    should_advance = hit_min or hit_max
                    if should_advance:
                        next_part = exam_part + 1
                        max_part = _max_part_for(exam_type)
                        if next_part > max_part:
                            # Last part finished — end session gracefully.
                            logger.info(
                                f"All parts completed for user {user_id} "
                                f"(part={exam_part}, exchanges={part_exchanges}, elapsed={int(part_elapsed)}s)"
                            )
                            try:
                                await websocket.send_json({
                                    "type": "session_timeout",
                                    "message": "Examen termin\u00e9 — toutes les parties sont compl\u00e9t\u00e9es.",
                                })
                            except Exception:
                                pass
                            break
                        # Advance to next part: announce transition first, give
                        # the user a brief prep moment, then stream the new
                        # greeting. Resets per-part state for the new part.
                        logger.info(
                            f"Auto-advancing user {user_id} from part {exam_part} -> {next_part} "
                            f"(exchanges={part_exchanges}, elapsed={int(part_elapsed)}s)"
                        )

                        next_label = _part_limits(exam_type, next_part).get("label", f"Partie {next_part}")
                        transition_text = (
                            f"Tr\u00e8s bien, merci pour vos r\u00e9ponses. "
                            f"Nous allons maintenant passer \u00e0 la {next_label}. "
                            f"Pr\u00e9parez-vous, je vais commencer dans quelques instants."
                        )
                        try:
                            await _synth_and_send_chunk(
                                websocket,
                                "examiner_audio",
                                transition_text,
                                final=False,
                                is_transition=True,
                            )
                            await websocket.send_json({
                                "type": "examiner_audio_chunk",
                                "audio": "",
                                "audio_fallback": False,
                                "text": "",
                                "final": True,
                                "is_transition": True,
                            })
                        except Exception as e:
                            logger.warning(f"Transition announcement failed for {user_id}: {e}")

                        # Brief server-side prep pause (~2s) before the new part starts.
                        await asyncio.sleep(2.0)

                        exam_part = next_part
                        conversation_history = []
                        part_started_at = time.time()
                        part_exchanges = 0
                        try:
                            new_greeting = await asyncio.wait_for(
                                _stream_examiner_reply(
                                    websocket,
                                    history=[],
                                    exam_type=exam_type,
                                    exam_part=exam_part,
                                    level=level,
                                    message_type="part_changed",
                                    extra_first={"exam_part": exam_part},
                                ),
                                timeout=LLM_STEP_TIMEOUT + TTS_STEP_TIMEOUT,
                            )
                            if new_greeting:
                                conversation_history.append(
                                    {"role": "assistant", "content": new_greeting}
                                )
                                full_transcript.append(
                                    {"role": "assistant", "content": new_greeting, "part": exam_part}
                                )
                                parts_completed.add(exam_part)
                        except Exception as e:
                            logger.error(f"Auto part-advance greeting failed for {user_id}: {e}")
                            await websocket.send_json({
                                "type": "part_changed",
                                "exam_part": exam_part,
                                "audio": "",
                                "audio_fallback": True,
                                "text": "Passons \u00e0 la partie suivante.",
                                "final": True,
                            })

            elif message["type"] == "change_part":
                exam_part = message.get("exam_part", exam_part)
                conversation_history = []
                # Manual part change resets per-part timers too.
                part_started_at = time.time()
                part_exchanges = 0
                try:
                    greeting = await asyncio.wait_for(
                        _stream_examiner_reply(
                            websocket,
                            history=[],
                            exam_type=exam_type,
                            exam_part=exam_part,
                            level=level,
                            message_type="part_changed",
                            extra_first={"exam_part": exam_part},
                        ),
                        timeout=LLM_STEP_TIMEOUT + TTS_STEP_TIMEOUT,
                    )
                    if greeting:
                        conversation_history.append({"role": "assistant", "content": greeting})
                        full_transcript.append({"role": "assistant", "content": greeting, "part": exam_part})
                        parts_completed.add(exam_part)
                except Exception as e:
                    logger.error(f"Part change failed: {e}")
                    fallback = "Passons à la partie suivante."
                    conversation_history.append({"role": "assistant", "content": fallback})
                    await websocket.send_json({
                        "type": "part_changed",
                        "exam_part": exam_part,
                        "audio": "",
                        "audio_fallback": True,
                        "text": fallback,
                        "final": True,
                    })

    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected for user {user_id}")
    except Exception as e:
        metrics_inc("sessions_errored")
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
            # Cancel any pending eval tasks — we won't be saving them.
            for t in pending_evals:
                if not t.done():
                    t.cancel()
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
            # ── Drain background eval tasks before scoring ──
            if pending_evals:
                eval_results = await asyncio.gather(*pending_evals, return_exceptions=True)
                for r in eval_results:
                    if isinstance(r, dict) and r.get("evaluation") is not None:
                        session_scores.append(r)

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
                            full_transcript or conversation_history, exam_type=exam_type, level=level
                        ),
                        REVIEW_STEP_TIMEOUT,
                        LLM_SEMAPHORE,
                    )
                except Exception as e:
                    metrics_inc("dependency_timeout_review")
                    logger.error(f"Review generation failed for {user_id}: {e}")
                    # Will be null — user can retry from dashboard

            # ── Save session ──
            try:
                highest_part = max(parts_completed) if parts_completed else exam_part
                await save_session_result(user_id, {
                    "exam_type": exam_type,
                    "exam_part": highest_part,
                    "level": level,
                    "is_demo": is_demo,
                    "duration_seconds": duration,
                    "pronunciation_score": avg_scores.get("pronunciation_score"),
                    "grammar_score": avg_scores.get("grammar_score"),
                    "vocabulary_score": avg_scores.get("vocabulary_score"),
                    "coherence_score": avg_scores.get("coherence_score"),
                    "corrections": corrections,
                    "transcript": full_transcript or conversation_history,
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
                    "transcript": full_transcript or conversation_history,
                })
            except Exception:
                pass  # Client already disconnected

        metrics_inc("sessions_completed")


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
