"""Tests for tools/prepare_sd.py, which sets up a flashed SD card to install
the kiosk on first boot. The sample cards here use made-up settings.

Run with: python3 -m unittest discover -s tests
"""

import contextlib
import io
import os
import sys
import tempfile
import unittest

PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(PROJECT_DIR, "tools"))

import prepare_sd  # noqa: E402

ITEM = "- " + prepare_sd.RUNCMD_ITEM

# Laid out like Raspberry Pi Imager 2's user-data: runcmd items indented,
# other lists (packages) not.
IMAGER_USER_DATA = """#cloud-config
manage_resolv_conf: false

hostname: my-pi
manage_etc_hosts: true
packages:
- avahi-daemon
timezone: America/New_York
user:
  name: pi
  lock_passwd: false
ssh_pwauth: true
runcmd:
  - [ sh, -c, "echo imager step" ]
"""

# Older Raspberry Pi Imager's firstrun.sh ends by deleting itself.
FIRSTRUN = """#!/bin/bash
set +e
echo "imager settings"
rm -f /boot/firmware/firstrun.sh
sed -i 's| systemd.run.*||g' /boot/firmware/cmdline.txt
exit 0
"""


class AddRuncmdTest(unittest.TestCase):
    def test_adds_after_imagers_items_keeping_everything_else(self):
        changed = prepare_sd.add_runcmd(IMAGER_USER_DATA)
        self.assertEqual(changed, IMAGER_USER_DATA + "  " + ITEM + "\n")

    def test_matches_items_written_without_indent(self):
        text = "#cloud-config\nruncmd:\n- echo one\n- echo two\npackages:\n- git\n"
        self.assertEqual(prepare_sd.add_runcmd(text),
                         "#cloud-config\nruncmd:\n- echo one\n- echo two\n" + ITEM + "\npackages:\n- git\n")

    def test_keeps_a_multi_line_item_whole(self):
        text = "runcmd:\n  - |\n    echo one\n    echo two\n\nuser:\n  name: pi\n"
        self.assertEqual(prepare_sd.add_runcmd(text),
                         "runcmd:\n  - |\n    echo one\n    echo two\n  " + ITEM + "\n\nuser:\n  name: pi\n")

    def test_makes_the_list_when_missing(self):
        text = "#cloud-config\nhostname: my-pi\n"
        self.assertEqual(prepare_sd.add_runcmd(text), text + "runcmd:\n  " + ITEM + "\n")

    def test_fills_an_empty_inline_list(self):
        text = "#cloud-config\nruncmd: []\nhostname: my-pi\n"
        self.assertEqual(prepare_sd.add_runcmd(text), "#cloud-config\nruncmd:\n  " + ITEM + "\nhostname: my-pi\n")

    def test_refuses_to_guess_at_a_one_line_list(self):
        with self.assertRaises(prepare_sd.Problem):
            prepare_sd.add_runcmd("runcmd: [echo one]\n")

    def test_adds_only_once(self):
        once = prepare_sd.add_runcmd(IMAGER_USER_DATA)
        self.assertEqual(prepare_sd.add_runcmd(once), once)


class FirstrunTest(unittest.TestCase):
    def test_adds_before_firstrun_deletes_itself(self):
        lines = prepare_sd.add_to_firstrun(FIRSTRUN).splitlines()
        at = lines.index(prepare_sd.FIRSTRUN_LINE)
        self.assertEqual(lines[at - 1], 'echo "imager settings"')
        self.assertEqual(lines[at + 1], "rm -f /boot/firmware/firstrun.sh")
        self.assertEqual(prepare_sd.add_to_firstrun("\n".join(lines) + "\n"), "\n".join(lines) + "\n")


class RepositoryTest(unittest.TestCase):
    def test_clone_addresses_become_https(self):
        for url, https in [
            ("https://github.com/someone/project.git", "https://github.com/someone/project.git"),
            ("git@github.com:someone/project.git\n", "https://github.com/someone/project.git"),
            ("ssh://git@github.com/someone/project.git", "https://github.com/someone/project.git"),
        ]:
            with self.subTest(url=url):
                self.assertEqual(prepare_sd.https_url(url), https)
        with self.assertRaises(prepare_sd.Problem):
            prepare_sd.https_url("/some/local/folder")


class CardTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.boot = os.path.join(self.tmp.name, "bootfs")
        os.mkdir(self.boot)
        for name in ["cmdline.txt", "config.txt"]:
            with open(os.path.join(self.boot, name), "w") as f:
                f.write("\n")

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, name, text):
        with open(os.path.join(self.boot, name), "w", newline="\n") as f:
            f.write(text)

    def run_main(self, *args):
        # Keeps its messages out of the test output.
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            return prepare_sd.main(list(args))

    def read(self, name):
        with open(os.path.join(self.boot, name), newline="") as f:
            return f.read()

    def test_finds_the_one_boot_partition(self):
        other = os.path.join(self.tmp.name, "USB stick")
        os.mkdir(other)
        self.assertEqual(prepare_sd.find_boot_partition([other, self.boot]), os.path.realpath(self.boot))
        with self.assertRaises(prepare_sd.Problem):
            prepare_sd.find_boot_partition([other])

    def test_prepares_a_cloud_init_card(self):
        self.write("user-data", IMAGER_USER_DATA)
        self.assertEqual(self.run_main(*[self.boot, "--repo", "git@github.com:someone/project.git"]), 0)
        self.assertIn(ITEM, self.read("user-data"))
        self.assertEqual(self.read(prepare_sd.CONF_NAME), "repo=https://github.com/someone/project.git\n")
        script = self.read(prepare_sd.SCRIPT_NAME)
        with open(os.path.join(PROJECT_DIR, "kiosk", "firstboot.sh"), newline="") as f:
            self.assertEqual(script, f.read())
        self.assertNotIn("\r", script)
        # Running it again changes nothing.
        self.assertEqual(self.run_main(*[self.boot, "--repo", "https://github.com/someone/project.git"]), 0)
        self.assertEqual(self.read("user-data").count(prepare_sd.SCRIPT_NAME), 1)

    def test_prepares_a_firstrun_card(self):
        self.write("firstrun.sh", FIRSTRUN)
        self.assertEqual(self.run_main(*[self.boot, "--repo", "https://github.com/someone/project.git"]), 0)
        self.assertIn(prepare_sd.FIRSTRUN_LINE, self.read("firstrun.sh"))

    def test_a_card_without_imager_settings_is_left_alone(self):
        self.assertEqual(self.run_main(*[self.boot, "--repo", "https://github.com/someone/project.git"]), 1)
        self.assertFalse(os.path.exists(os.path.join(self.boot, prepare_sd.SCRIPT_NAME)))

    def test_a_folder_that_isnt_a_boot_partition_is_left_alone(self):
        self.assertEqual(self.run_main(*[self.tmp.name, "--repo", "https://github.com/someone/project.git"]), 1)


if __name__ == "__main__":
    unittest.main()
