"""Keeps upstream's NLTK start-up check off the network when the data is already here.

speech_to_speech.s2s_pipeline looks for the POS tagger under "tokenizers/", but NLTK
keeps it under "taggers/", so that lookup always fails and nltk.download runs on every
start: a fetch of NLTK's package index from GitHub. The launcher points NLTK_DATA at
the app's own nltk_data folder, which already holds both packages it asks for.

Only a download of a package that is already installed is skipped; anything missing
still downloads as upstream intends.
"""
import nltk

_CATEGORIES = ("tokenizers", "taggers", "corpora")


def is_installed(package):
    for category in _CATEGORIES:
        try:
            nltk.data.find(f"{category}/{package}")
            return True
        except LookupError:
            continue
    return False


def install():
    original = nltk.download
    if getattr(original, "_zd_offline", False):
        return

    def download(info_or_id=None, *args, **kwargs):
        if isinstance(info_or_id, str) and is_installed(info_or_id):
            return True
        return original(info_or_id, *args, **kwargs)

    download._zd_offline = True
    download._zd_original = original
    nltk.download = download
