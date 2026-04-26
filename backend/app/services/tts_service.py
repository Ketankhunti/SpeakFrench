import asyncio
import hashlib
import logging
from collections import OrderedDict
from typing import Optional

import azure.cognitiveservices.speech as speechsdk
import redis
from redis.exceptions import RedisError

from app.core.config import settings
from app.services.metrics import inc as metrics_inc

logger = logging.getLogger(__name__)

# ── TTS cache ──
# Cache synthesized MP3 bytes keyed by sha256(text + rate). Greetings and other
# repeated phrases (e.g. fallback messages) skip Azure entirely on a hit.
_TTS_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60  # 7 days
_TTS_LOCAL_MAX_ENTRIES = 128
_TTS_LOCAL_CACHE: "OrderedDict[str, bytes]" = OrderedDict()
_TTS_LOCAL_LOCK = asyncio.Lock()


def _tts_cache_key(text: str, rate: str, ssml: bool) -> str:
    digest = hashlib.sha256(f"{rate}|{int(ssml)}|{text}".encode("utf-8")).hexdigest()
    return f"tts:{digest}"


def _get_tts_redis_client() -> Optional[redis.Redis]:
    """Binary Redis client (decode_responses=False) for caching audio bytes."""
    if not settings.redis_enabled:
        return None
    try:
        return redis.Redis.from_url(settings.redis_url, decode_responses=False)
    except Exception:
        return None


async def _cache_get(key: str) -> Optional[bytes]:
    r = _get_tts_redis_client()
    if r is not None:
        try:
            value = await asyncio.to_thread(r.get, key)
            if value:
                return bytes(value)
        except RedisError:
            pass
    async with _TTS_LOCAL_LOCK:
        value = _TTS_LOCAL_CACHE.get(key)
        if value is not None:
            _TTS_LOCAL_CACHE.move_to_end(key)
        return value


async def _cache_set(key: str, audio: bytes) -> None:
    r = _get_tts_redis_client()
    if r is not None:
        try:
            await asyncio.to_thread(r.set, key, audio, ex=_TTS_CACHE_TTL_SECONDS)
            return
        except RedisError:
            pass
    async with _TTS_LOCAL_LOCK:
        _TTS_LOCAL_CACHE[key] = audio
        _TTS_LOCAL_CACHE.move_to_end(key)
        while len(_TTS_LOCAL_CACHE) > _TTS_LOCAL_MAX_ENTRIES:
            _TTS_LOCAL_CACHE.popitem(last=False)


def get_speech_config() -> speechsdk.SpeechConfig:
    speech_config = speechsdk.SpeechConfig(
        subscription=settings.azure_speech_key,
        region=settings.azure_speech_region,
    )
    speech_config.speech_synthesis_voice_name = "fr-FR-DeniseNeural"
    speech_config.speech_recognition_language = "fr-FR"
    return speech_config


def _text_to_speech_sync(text: str) -> bytes:
    """Sync implementation for French text-to-speech."""
    speech_config = get_speech_config()
    speech_config.set_speech_synthesis_output_format(
        speechsdk.SpeechSynthesisOutputFormat.Audio16Khz32KBitRateMonoMp3
    )

    synthesizer = speechsdk.SpeechSynthesizer(
        speech_config=speech_config, audio_config=None
    )

    result = synthesizer.speak_text_async(text).get()

    if result.reason == speechsdk.ResultReason.SynthesizingAudioCompleted:
        return result.audio_data
    elif result.reason == speechsdk.ResultReason.Canceled:
        cancellation = result.cancellation_details
        raise RuntimeError(
            f"TTS canceled: {cancellation.reason} - {cancellation.error_details}"
        )
    else:
        raise RuntimeError(f"TTS failed with reason: {result.reason}")


def _text_to_speech_ssml_sync(text: str, rate: str = "0%") -> bytes:
    """Sync implementation for SSML text-to-speech."""
    speech_config = get_speech_config()
    speech_config.set_speech_synthesis_output_format(
        speechsdk.SpeechSynthesisOutputFormat.Audio16Khz32KBitRateMonoMp3
    )

    ssml = f"""
    <speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="fr-FR">
        <voice name="fr-FR-DeniseNeural">
            <prosody rate="{rate}">
                {text}
            </prosody>
        </voice>
    </speak>
    """

    synthesizer = speechsdk.SpeechSynthesizer(
        speech_config=speech_config, audio_config=None
    )

    result = synthesizer.speak_ssml_async(ssml).get()

    if result.reason == speechsdk.ResultReason.SynthesizingAudioCompleted:
        return result.audio_data
    elif result.reason == speechsdk.ResultReason.Canceled:
        cancellation = result.cancellation_details
        raise RuntimeError(
            f"TTS canceled: {cancellation.reason} - {cancellation.error_details}"
        )
    else:
        raise RuntimeError(f"TTS failed with reason: {result.reason}")


async def text_to_speech(text: str) -> bytes:
    """Convert French text to speech audio using Azure Neural TTS."""
    key = _tts_cache_key(text, rate="0%", ssml=False)
    cached = await _cache_get(key)
    if cached is not None:
        metrics_inc("tts_cache_hit")
        return cached
    metrics_inc("tts_cache_miss")
    audio = await asyncio.to_thread(_text_to_speech_sync, text)
    try:
        await _cache_set(key, audio)
    except Exception as e:
        logger.warning(f"TTS cache set failed: {e}")
    return audio


async def text_to_speech_ssml(text: str, rate: str = "0%") -> bytes:
    """Convert French text to speech with SSML control for speed adjustment."""
    key = _tts_cache_key(text, rate=rate, ssml=True)
    cached = await _cache_get(key)
    if cached is not None:
        metrics_inc("tts_cache_hit")
        return cached
    metrics_inc("tts_cache_miss")
    audio = await asyncio.to_thread(_text_to_speech_ssml_sync, text, rate)
    try:
        await _cache_set(key, audio)
    except Exception as e:
        logger.warning(f"TTS cache set failed: {e}")
    return audio
