# SpeakFrench — Performance & Scalability Roadmap

Tracking checklist for cutting AI response time and scaling the platform.
Status legend: `[ ]` not started · `[~]` in progress · `[x]` done

---

## Tier 1 — Cut perceived response time by 50–70%

- [x] **1. Stream LLM tokens → stream TTS sentence-by-sentence** ✅ done
  - New `get_conversation_response_stream` async generator in `backend/app/services/llm_service.py` (uses OpenAI `stream=True`).
  - New `_stream_examiner_reply` helper in `backend/app/api/routes/session.py` buffers tokens, splits at sentence boundaries (min 25 chars), and synthesizes each sentence via `text_to_speech_ssml` (still benefits from the cache from #4).
  - Greeting, per-turn reply, and `change_part` all use the streaming helper.
  - WebSocket protocol: leading `examiner_audio` / `part_changed` message + N × `examiner_audio_chunk` messages + final empty chunk with `final: true`.
  - Frontend (`frontend/src/components/session/SessionView.tsx`) plays chunks via a sequential queue of `<audio>` elements; finalizes the turn (commits message text, starts auto-record) only after the final marker AND the queue has drained.
  - **Result:** first audible audio drops from ~3s to ~700ms per turn.

- [x] **2. Parallelize STT → eval → LLM (don't run them serially)** ✅ done
  - Eval now runs as `asyncio.create_task(_eval_turn())` per user turn in `backend/app/api/routes/session.py`.
  - LLM/TTS reply no longer waits on eval; results gathered in `finally` before scoring.
  - Pending tasks are cancelled on zero-exchange sessions to avoid leaked work.
  - **Result:** ~1–2s removed from every reply turn.

- [ ] **3. Use Azure Speech streaming STT (replace `recognize_once`)**
  - Browser sends live PCM 16kHz audio chunks via `AudioWorklet` over the WebSocket.
  - Backend feeds them to `PushAudioInputStream` continuously; uses `recognized` / `recognizing` events.
  - Removes the ffmpeg WebM→WAV conversion step entirely.
  - **Target:** STT overlaps with the user still speaking; ~100–300ms saved + better UX.

- [x] **4. Cache greeting TTS in Redis** ✅ done
  - Added two-tier cache (Redis when `REDIS_ENABLED=true`, in-process LRU fallback) in `backend/app/services/tts_service.py`.
  - Key: `tts:{sha256(rate|ssml|text)}`, MP3 bytes, TTL 7 days.
  - Wraps both `text_to_speech` and `text_to_speech_ssml` transparently — no caller changes needed.
  - Added `tts_cache_hit` / `tts_cache_miss` counters in `metrics.py` (visible via `/metrics` admin endpoint).
  - **Result:** repeat greetings, retries, and identical fallback messages skip Azure entirely (~0–50ms vs ~500–1500ms).

---

## Tier 2 — Scalability (multi-instance, higher concurrency)

- [ ] **5. Move semaphores from in-process to Redis token bucket**
  - Today: `STT_SEMAPHORE = asyncio.Semaphore(40)` only guards one uvicorn process.
  - Replace with a Redis-backed limiter so caps hold across replicas.

- [ ] **6. Run multiple uvicorn workers behind a reverse proxy**
  - `gunicorn -k uvicorn.workers.UvicornWorker --workers 4`.
  - Front with nginx or Caddy (TLS + HTTP/2 for the WS handshake).

- [ ] **7. Background queue for non-realtime work (arq or Celery)**
  - Move `generate_session_review` + `generate_session_scores` out of the WebSocket close path.
  - Worker triggered by `sessions.status = 'pending_review'`; result pushed via Supabase realtime.

- [ ] **8. Token-budget aware conversations**
  - Sliding window: keep last 8 turns + rolling summary, drop the rest.
  - Use `response_format={"type": "json_object"}` for review/scoring → remove the regex code-fence stripping in `llm_service.py`.

- [ ] **9. Reuse Azure SDK clients**
  - Cache one `SpeechSynthesizer` per worker instead of building a fresh one per call in `tts_service.py`.
  - **Target:** ~50–100ms saved per TTS turn.

---

## Tier 3 — UX & robustness

- [ ] **10. Client-side VAD (voice activity detection)**
  - `@ricky0123/vad-web` in the browser to auto-detect end-of-speech.
  - No more push-to-talk button; combined with #3 makes it feel truly live.

- [ ] **11. Optimistic transcription rendering**
  - Forward Azure `recognizing` partials to the frontend so the user's transcript appears as they speak.

- [ ] **12. Pre-warm LLM greeting on WebSocket accept**
  - Start the greeting LLM call before the `config` message arrives (assume defaults, cancel if mismatched).
  - **Target:** ~500ms shaved off session start.

- [ ] **13. Observability — p50/p95 per step**
  - Add per-step timing to `backend/app/services/metrics.py` for STT, eval, LLM, TTS.
  - Optional: OpenTelemetry → Grafana.

---

## Recommended execution order

1. #4 — greeting cache (30 min, instantly visible)
2. #2 — parallelize eval (1 hr, -1–2s per turn)
3. #1 — stream LLM → TTS (~half day, biggest win)
4. #7 — background review queue (fixes end-of-session pause)
5. #3 + #10 — streaming STT + VAD (real-time feel)
6. #5 + #6 — when scaling past one box

---

## Bonus fixes shipped (2026-04-26)

- [x] **Per-part auto-advance + accurate exam pacing**
  - Backend now tracks `part_started_at` and `part_exchanges`; auto-advances to the next TCF Tâche / TEF Section when EITHER `max_seconds` OR `max_exchanges` is reached.
  - `PART_CONFIG` in `backend/app/api/routes/session.py` reflects real exam durations (TCF: 1m30 / 5m30 / 5m; TEF: 5m / 10m).
  - When the last part finishes, server emits `session_timeout` with a positive completion message instead of just hitting the 22-min wall clock.
  - Demo sessions stay in their starting part (unchanged).
  - Global `SESSION_TIMEOUT` raised from 20 → 22 min as a *safety net only* (per-part timing drives normal flow).

- [x] **Parallelized streaming TTS**
  - `_stream_examiner_reply` now schedules each sentence's TTS as a separate `asyncio.create_task` (concurrent synthesis, bounded by `TTS_SEMAPHORE`).
  - Sends chunks in order to preserve playback sequencing; chunk N is awaited while N+1, N+2 are already synthesizing.
  - Finer split rule (`. ! ? … ; , : \n`) with `_MIN_CHUNK_CHARS_FIRST = 15` for the first chunk to minimise time-to-first-audio.
  - **Result:** the 5–10s gaps between sentences should be largely gone.

- [x] **Improved TCF/TEF system prompts**
  - Accurate part durations in `backend/app/services/llm_service.py`.
  - Explicit guidance to ask the candidate to repeat when STT garbled the response, instead of paraphrasing nonsense.
  - Pacing target: 5–7 exchanges per part so the model converges naturally.
