import json
import io
import azure.cognitiveservices.speech as speechsdk
from pydub import AudioSegment
import imageio_ffmpeg
from app.core.config import settings

# Point pydub to the bundled ffmpeg
AudioSegment.converter = imageio_ffmpeg.get_ffmpeg_exe()
AudioSegment.ffprobe = imageio_ffmpeg.get_ffmpeg_exe()


def _convert_to_wav(audio_data: bytes) -> bytes:
    """Convert any audio format (WebM/Opus, MP3, etc.) to 16kHz mono WAV for Azure STT."""
    try:
        # Explicitly specify webm format so pydub doesn't need ffprobe to detect it
        audio = AudioSegment.from_file(io.BytesIO(audio_data), format="webm")
        audio = audio.set_frame_rate(16000).set_channels(1).set_sample_width(2)
        wav_buffer = io.BytesIO()
        audio.export(wav_buffer, format="wav")
        return wav_buffer.getvalue()
    except Exception as e:
        raise ValueError(f"Audio conversion failed: {e}")


def get_speech_config() -> speechsdk.SpeechConfig:
    speech_config = speechsdk.SpeechConfig(
        subscription=settings.azure_speech_key,
        region=settings.azure_speech_region,
    )
    speech_config.speech_recognition_language = "fr-FR"
    return speech_config


async def speech_to_text(audio_data: bytes) -> dict:
    """Transcribe French speech audio to text using Azure STT."""
    try:
        wav_data = _convert_to_wav(audio_data)
    except ValueError as e:
        return {"text": "", "success": False, "error": str(e)}

    speech_config = get_speech_config()

    audio_stream = speechsdk.audio.PushAudioInputStream()
    audio_stream.write(wav_data)
    audio_stream.close()

    audio_config = speechsdk.audio.AudioConfig(stream=audio_stream)
    recognizer = speechsdk.SpeechRecognizer(
        speech_config=speech_config, audio_config=audio_config
    )

    result = recognizer.recognize_once_async().get()

    if result.reason == speechsdk.ResultReason.RecognizedSpeech:
        return {"text": result.text, "success": True}
    elif result.reason == speechsdk.ResultReason.NoMatch:
        return {"text": "", "success": False, "error": "No speech recognized"}
    elif result.reason == speechsdk.ResultReason.Canceled:
        cancellation = result.cancellation_details
        return {
            "text": "",
            "success": False,
            "error": f"Canceled: {cancellation.reason}",
        }
    else:
        return {"text": "", "success": False, "error": f"Failed: {result.reason}"}


async def speech_to_text_with_pronunciation(audio_data: bytes, reference_text: str = "") -> dict:
    """Transcribe and assess pronunciation of French speech."""
    try:
        wav_data = _convert_to_wav(audio_data)
    except ValueError as e:
        return {"text": "", "success": False, "error": str(e)}

    speech_config = get_speech_config()

    pronunciation_config = speechsdk.PronunciationAssessmentConfig(
        reference_text=reference_text if reference_text else None,
        grading_system=speechsdk.PronunciationAssessmentGradingSystem.HundredMark,
        granularity=speechsdk.PronunciationAssessmentGranularity.Phoneme,
        enable_miscue=True,
    )

    audio_stream = speechsdk.audio.PushAudioInputStream()
    audio_stream.write(wav_data)
    audio_stream.close()

    audio_config = speechsdk.audio.AudioConfig(stream=audio_stream)
    recognizer = speechsdk.SpeechRecognizer(
        speech_config=speech_config, audio_config=audio_config
    )
    pronunciation_config.apply_to(recognizer)

    result = recognizer.recognize_once_async().get()

    if result.reason == speechsdk.ResultReason.RecognizedSpeech:
        pronunciation_result = speechsdk.PronunciationAssessmentResult(result)
        return {
            "text": result.text,
            "success": True,
            "pronunciation": {
                "accuracy_score": pronunciation_result.accuracy_score,
                "fluency_score": pronunciation_result.fluency_score,
                "completeness_score": pronunciation_result.completeness_score,
                "pronunciation_score": pronunciation_result.pronunciation_score,
            },
        }
    elif result.reason == speechsdk.ResultReason.NoMatch:
        return {"text": "", "success": False, "error": "No speech recognized"}
    else:
        return {"text": "", "success": False, "error": f"Failed: {result.reason}"}
