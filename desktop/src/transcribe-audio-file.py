"""Transcribe a local audio file with the already installed Parakeet model.

The command prints one JSON result to stdout. It never calls a cloud API and
requires the model to be present in the local Hugging Face cache.
"""

import argparse
import json
import os
import sys
from pathlib import Path

SUPPORTED_EXTENSIONS = {".wav", ".wave", ".flac", ".ogg", ".opus", ".mp3", ".aiff", ".aif"}
MAX_SECONDS = 2 * 60 * 60
MAX_BYTES = 500 * 1024 * 1024
BLOCK_SECONDS = 60


def inspect_file(path):
    import soundfile as sf

    file_path = Path(path).expanduser().resolve(strict=True)
    if not file_path.is_file() or file_path.suffix.lower() not in SUPPORTED_EXTENSIONS:
        raise ValueError("Choose a supported audio file: WAV, FLAC, OGG, OPUS, MP3, or AIFF.")
    if file_path.stat().st_size > MAX_BYTES:
        raise ValueError("This audio file is too large (maximum 500 MB).")
    try:
        info = sf.info(str(file_path))
    except Exception as exc:
        raise ValueError("Could not decode this audio file.") from exc
    if not info.frames or not info.samplerate or info.duration > MAX_SECONDS:
        raise ValueError("Choose audio shorter than two hours.")
    return file_path, info


def transcribe(path):
    import numpy as np
    import soundfile as sf
    from scipy.signal import resample_poly
    from math import gcd
    from nano_parakeet import from_pretrained
    import nano_parakeet.model as parakeet_model

    file_path, info = inspect_file(path)
    # The installed nano_parakeet CPU decoder returns two values for timestamp
    # requests, while its public transcribe method expects the encoder length
    # as a third value. Correct that contract in this worker process only.
    original_decode = parakeet_model.tdt_greedy_decode

    def decode_with_encoder_length(*args, **kwargs):
        result = original_decode(*args, **kwargs)
        if kwargs.get("return_timestamps") and len(result) == 2:
            return result[0], result[1], kwargs["enc_len"]
        return result

    parakeet_model.tdt_greedy_decode = decode_with_encoder_length
    model = from_pretrained(model_name="nvidia/parakeet-tdt-0.6b-v3", device="cpu")
    parts = []
    words = []
    elapsed = 0.0
    with sf.SoundFile(str(file_path)) as audio:
        for block in audio.blocks(blocksize=int(info.samplerate * BLOCK_SECONDS), dtype="float32", always_2d=True):
            mono = block.mean(axis=1)
            block_duration = len(mono) / info.samplerate
            if info.samplerate != 16000:
                divisor = gcd(info.samplerate, 16000)
                mono = resample_poly(mono, 16000 // divisor, info.samplerate // divisor)
            result = model.transcribe(np.asarray(mono, dtype=np.float32), timestamps=True)
            text = result.text.strip()
            if text:
                parts.append(text)
            for word in result.timestamp.get("word", []):
                words.append({
                    "word": word["word"],
                    "start": round(elapsed + word["start"], 3),
                    "end": round(elapsed + word["end"], 3),
                })
            elapsed += block_duration
    return {"text": "\n".join(parts), "words": words, "filename": file_path.name, "durationSeconds": round(info.duration, 2)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("file")
    parser.add_argument("--probe", action="store_true", help="Check decoding without loading the model")
    args = parser.parse_args()
    # A missing cache should fail explicitly instead of downloading model
    # weights or contacting a provider while processing private recordings.
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    try:
        if args.probe:
            file_path, info = inspect_file(args.file)
            result = {"filename": file_path.name, "durationSeconds": round(info.duration, 2)}
        else:
            result = transcribe(args.file)
        print(json.dumps(result, ensure_ascii=False))
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
