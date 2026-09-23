import os
import tempfile
import unittest

import nltk
import nltk_offline


class NltkOfflineTests(unittest.TestCase):
    def setUp(self):
        self.calls = []
        self.saved_download = nltk.download
        self.saved_path = list(nltk.data.path)
        nltk.download = lambda *args, **kwargs: self.calls.append(args) or "downloaded"
        self.folder = tempfile.TemporaryDirectory()
        os.makedirs(os.path.join(self.folder.name, "taggers", "averaged_perceptron_tagger_eng"))
        nltk.data.path[:] = [self.folder.name]
        nltk_offline.install()

    def tearDown(self):
        nltk.download = self.saved_download
        nltk.data.path[:] = self.saved_path
        self.folder.cleanup()

    def test_skips_a_package_installed_under_another_category(self):
        # Upstream's own check looks under tokenizers/ and misses it.
        with self.assertRaises(LookupError):
            nltk.data.find("tokenizers/averaged_perceptron_tagger_eng")
        self.assertIs(nltk.download("averaged_perceptron_tagger_eng"), True)
        self.assertEqual(self.calls, [])

    def test_still_downloads_what_is_missing(self):
        self.assertEqual(nltk.download("punkt_tab"), "downloaded")
        self.assertEqual(self.calls, [("punkt_tab",)])

    def test_installing_twice_wraps_once(self):
        wrapped = nltk.download
        nltk_offline.install()
        self.assertIs(nltk.download, wrapped)


if __name__ == "__main__":
    unittest.main()
