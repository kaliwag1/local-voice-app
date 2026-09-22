"""Opt-in startup hook for this app's speech process; never edits site-packages."""
import os
import sys

if os.environ.get("ZD_VOICE_REASONING_ADAPTER") == "1":
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
