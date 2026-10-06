import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from datetime import datetime
from unittest.mock import patch


spec = importlib.util.spec_from_file_location('deck_build', Path(__file__).parents[1] / 'build.py')
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)


class BuildInfoTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='deck-build-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        root_patch = patch.object(build, 'ROOT', str(self.root))
        root_patch.start()
        self.addCleanup(root_patch.stop)
        self.git('init', '-q')
        self.git('config', 'user.name', 'Build Test')
        self.git('config', 'user.email', 'build-test@example.com')
        for name in [*build.GENERATED, 'web/body.html', 'app/companion.js', 'web/head.css.html']:
            self.write(name, '})();' if name == 'web/body.html' else 'original')
        self.git('add', '.')
        self.git('commit', '-qm', 'fixture')

    def git(self, *args):
        return subprocess.check_output(['git', *args], cwd=self.root, stderr=subprocess.PIPE).decode().strip()

    def write(self, name, content):
        file = self.root / name
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(content)

    def test_clean_stamp(self):
        stamp = build.build_info()
        self.assertEqual(stamp['commit'], self.git('rev-parse', 'HEAD'))
        self.assertFalse(stamp['dirty'])
        self.assertIsNotNone(datetime.fromisoformat(stamp['built']).tzinfo)

    def test_generated_changes_are_ignored(self):
        for name in build.GENERATED:
            self.write(name, 'generated change')
        self.assertFalse(build.build_info()['dirty'])
        self.git('add', '.')
        self.assertFalse(build.build_info()['dirty'])

    def test_missing_or_untracked_generated_files_are_ignored(self):
        self.git('rm', '-q', *build.GENERATED)
        self.git('commit', '-qm', 'remove generated files')
        self.assertFalse(build.build_info()['dirty'])
        for name in build.GENERATED:
            self.write(name, 'untracked generated file')
        self.assertFalse(build.build_info()['dirty'])

    def test_source_change_is_dirty(self):
        self.write('app/companion.js', 'local work')
        self.assertTrue(build.build_info()['dirty'])

    def test_untracked_source_is_dirty_even_in_new_directory(self):
        self.write('app/new modules/name with\nnewline.js', 'local work')
        self.assertTrue(build.build_info()['dirty'])

    def test_renamed_source_to_generated_file_is_dirty(self):
        self.git('rm', '-q', 'app/build-info.json')
        self.git('mv', 'app/companion.js', 'app/build-info.json')
        self.assertTrue(build.build_info()['dirty'])

    def test_git_unavailable(self):
        with patch.object(build.subprocess, 'check_output', side_effect=FileNotFoundError('git')):
            stamp = build.build_info()
        self.assertIsNone(stamp['commit'])
        self.assertFalse(stamp['dirty'])
        datetime.fromisoformat(stamp['built'])

    def test_git_status_failure_preserves_known_commit(self):
        with patch.object(build.subprocess, 'check_output', side_effect=[
            b'a' * 40, subprocess.CalledProcessError(128, 'git')
        ]):
            self.assertEqual(build.build_info()['commit'], 'a' * 40)

    def test_unborn_repo_has_null_commit_and_detects_dirty_files(self):
        fresh = self.root / 'fresh'
        fresh.mkdir()
        subprocess.check_call(['git', 'init', '-q', str(fresh)])
        (fresh / 'source.js').write_text('local work')
        with patch.object(build, 'ROOT', str(fresh)):
            stamp = build.build_info()
        self.assertIsNone(stamp['commit'])
        self.assertTrue(stamp['dirty'])

    def test_build_writes_stamp_and_keeps_generated_only_tree_clean(self):
        # Existing tracked generated files can all change without marking a build dirty.
        with patch('builtins.print') as output:
            build.main()
        output.assert_called_once_with('built web/StreamDeck-Ayar.html, app/index.html and app/build-info.json')
        stamp = json.loads((self.root / 'app/build-info.json').read_text())
        self.assertEqual(stamp['commit'], self.git('rev-parse', 'HEAD'))
        self.assertFalse(stamp['dirty'])
        self.assertIn('desktop app additions', (self.root / 'app/index.html').read_text())


class OfflineEmbedTests(unittest.TestCase):
    """Fonts and the firmware flasher go inside the built pages; nothing is fetched at run time."""
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='deck-embed-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        root_patch = patch.object(build, 'ROOT', str(self.root))
        root_patch.start()
        self.addCleanup(root_patch.stop)

    def write(self, name, content):
        file = self.root / name
        file.parent.mkdir(parents=True, exist_ok=True)
        (file.write_bytes if isinstance(content, bytes) else file.write_text)(content)

    def test_fonts_become_data_uris_and_marker_disappears(self):
        self.write('web/fonts/a.woff2', b'wOF2font')
        self.write('web/fonts/fonts.css', '/* c */\n@font-face{font-family:"X";src:url(a.woff2) format("woff2")}\n')
        out = build.inline_fonts('<title>t</title>\n<!--@FONTS@ not\nshown -->\n<style>b{}</style>')
        self.assertIn('url(data:font/woff2;base64,d09GMmZvbnQ=) format("woff2")', out)
        self.assertNotIn('@FONTS@', out)
        self.assertNotIn('fonts.googleapis', out)
        self.assertTrue(out.index('@font-face') < out.index('b{}'))

    def test_fonts_reject_paths_and_tolerate_missing_folder(self):
        self.assertEqual(build.inline_fonts('a<!--@FONTS@-->\nb'), 'ab')
        self.write('web/fonts/fonts.css', '@font-face{src:url(../secret.woff2)}')
        with self.assertRaises(ValueError):
            build.inline_fonts('<!--@FONTS@-->')

    def test_esptool_is_embedded_once(self):
        body = 'const ESPTOOL_B64=/*@ESPTOOL@*/null;'
        self.assertEqual(build.embed_esptool(body), body)
        self.write('web/vendor/esptool-js/bundle.js', 'export{}')
        self.assertEqual(build.embed_esptool(body), 'const ESPTOOL_B64="ZXhwb3J0e30=";')

    def test_repository_pages_need_no_network(self):
        repo = Path(__file__).parents[2]
        head = (repo / 'web/head.css.html').read_text(encoding='utf-8')
        body = (repo / 'web/body.html').read_text(encoding='utf-8')
        self.assertIn('<!--@FONTS@', head)
        self.assertNotIn('fonts.googleapis', head)
        self.assertEqual(body.count(build.ESPTOOL_MARK), 1)
        for name in ['web/fonts/fonts.css', 'web/vendor/esptool-js/bundle.js', 'web/vendor/esptool-js/LICENSE']:
            self.assertTrue((repo / name).is_file(), name)
        built = (repo / 'app/index.html').read_text(encoding='utf-8')
        self.assertNotIn('fonts.googleapis', built)
        self.assertIn('url(data:font/woff2;base64,', built)
        self.assertNotIn(build.ESPTOOL_MARK, built)


if __name__ == '__main__':
    unittest.main()
