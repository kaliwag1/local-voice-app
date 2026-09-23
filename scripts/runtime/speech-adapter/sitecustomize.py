"""Opt-in startup hook for this app's speech process; never edits site-packages."""
import os
import sys

if os.environ.get("ZD_VOICE_REASONING_ADAPTER") == "1":
    # First, so the text-only backends exist before any argument parsing. Registering
    # them changes nothing unless the service is started with --stt/--tts text-only.
    try:
        from text_only import install as install_text_only
        install_text_only()
    except Exception as error:
        print(f"ZD Voice text-only mode unavailable: {type(error).__name__}: {error}", file=sys.stderr)

    try:
        from reasoning_adapter import install
        install()
    except Exception as error:
        # Unknown upstream versions keep normal speech; reasoning stays unavailable.
        print(f"ZD Voice reasoning adapter unavailable: {type(error).__name__}: {error}", file=sys.stderr)

    # Installed on its own, so an upstream change to the audio path turns off only
    # this fix - reasoning and formatting keep working, and so does speech, with
    # upstream's per-block resampling back in place.
    try:
        from seamless_audio import install as install_seamless_audio
        install_seamless_audio()
    except Exception as error:
        print(f"ZD Voice seamless audio unavailable: {type(error).__name__}: {error}", file=sys.stderr)

    # Upstream checks for NLTK's tagger in the wrong folder and so downloads on every
    # start; skip that when the app's own nltk_data already has it.
    try:
        from nltk_offline import install as install_nltk_offline
        install_nltk_offline()
    except Exception as error:
        print(f"ZD Voice NLTK offline check unavailable: {type(error).__name__}: {error}", file=sys.stderr)
