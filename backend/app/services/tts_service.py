import azure.cognitiveservices.speech as speechsdk
from app.core.config import settings


def get_speech_config() -> speechsdk.SpeechConfig:
    speech_config = speechsdk.SpeechConfig(
        subscription=settings.azure_speech_key,
        region=settings.azure_speech_region,
    )
    speech_config.speech_synthesis_voice_name = "fr-FR-DeniseNeural"
    speech_config.speech_recognition_language = "fr-FR"
    return speech_config


async def text_to_speech(text: str) -> bytes:
    """Convert French text to speech audio using Azure Neural TTS."""
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


async def text_to_speech_ssml(text: str, rate: str = "0%") -> bytes:
    """Convert French text to speech with SSML control for speed adjustment."""
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
