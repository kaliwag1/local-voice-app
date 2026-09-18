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
