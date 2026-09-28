"""Checks that the Pi-side files agree with each other.

The installer, the kiosk launcher, the boot splash, and the server refer to
each other by name (a page title, a service, a theme). A mismatch doesn't
fail anywhere else: the kiosk just misbehaves (the watchdog keeps reloading,
"Check for updates" does nothing, the boot splash or the hidden pointer is
lost). These tests read the files; they don't run the installer.

Run with: python3 -m unittest discover -s tests
"""

import os
import re
import subprocess
import tempfile
import unittest

PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(path):
    with open(os.path.join(PROJECT_DIR, path), encoding="utf-8") as f:
        return f.read()


def one(pattern, text, what):
    """The single distinct value `pattern`'s group matches in `text`."""
    found = set(re.findall(pattern, text, re.M))
    if len(found) != 1:
        raise AssertionError(f"expected one {what}, found {sorted(found) or 'none'}")
    return found.pop()


class InstallerTest(unittest.TestCase):
    def setUp(self):
        self.install = read("install.sh")

    def test_page_titles_include_the_title_the_watchdog_looks_for(self):
        # kiosk.sh counts the app as loaded when a tab's title contains this.
        app_title = one(r'^APP_TITLE="([^"]+)"', read("kiosk/kiosk.sh"), "APP_TITLE")
        for page in ["web/index.html", "web/setup.html"]:
            with self.subTest(page=page):
                title = one(r"<title>([^<]+)</title>", read(page), "title")
                self.assertIn(app_title, title)

    def test_the_update_service_has_one_name_everywhere(self):
        service = one(r"/etc/systemd/system/([\w-]+)\.service >/dev/null <<EOF\n(?:.*\n){0,8}?ExecStart=\$APP_DIR/kiosk/update\.sh",
                      self.install, "update service")
        # The permission rule lets the kiosk start exactly this service...
        self.assertIn(f'action.lookup("unit") === "{service}.service"', self.install)
        # ...which is what the About tab's update button starts...
        self.assertIn(f'"{service}.service"', read("server/system.py"))
        # ...and its timer runs it weekly.
        self.assertIn(f"/etc/systemd/system/{service}.timer", self.install)
        self.assertIn(f"systemctl enable --now {service}.timer", self.install)

    def test_the_boot_splash_theme_name_matches_its_files(self):
        theme = one(r"^SPLASH_DIR=/usr/share/plymouth/themes/([\w-]+)$", self.install, "splash theme")
        self.assertIn(f'= "{theme}" ]', self.install)
        self.assertIn(f"plymouth-set-default-theme -R {theme}\n", self.install)
        # Plymouth finds a theme by its folder and .plymouth file sharing a name.
        plymouth = read(f"kiosk/boot-splash/{theme}.plymouth")
        self.assertIn(f"ImageDir=/usr/share/plymouth/themes/{theme}\n", plymouth)
        script = one(rf"ScriptFile=/usr/share/plymouth/themes/{theme}/([\w.-]+)", plymouth, "ScriptFile")
        for image in re.findall(r'Image\("([^"]+)"\)', read(f"kiosk/boot-splash/{script}")):
            with self.subTest(image=image):
                self.assertTrue(os.path.isfile(os.path.join(PROJECT_DIR, "kiosk/boot-splash", image)))

    def test_the_hidden_pointer_theme_is_the_one_the_helper_makes(self):
        selected = one(r"XCURSOR_THEME=([\w-]+)", self.install, "XCURSOR_THEME")
        made = one(r'^THEME_NAME = "([\w-]+)"', read("kiosk/make_blank_cursor_theme.py"), "THEME_NAME")
        self.assertEqual(selected, made)

    def test_the_files_the_installer_and_launcher_use_exist(self):
        paths = set(re.findall(r"\$APP_DIR/([\w./-]+)", self.install)) - {".git"}
        paths |= {f"kiosk/{name}" for name in re.findall(r'\$\(dirname "\$0"\)/([\w./-]+)', read("kiosk/kiosk.sh"))}
        self.assertIn("server/server.py", paths)  # the patterns still find things
        for path in sorted(paths):
            with self.subTest(path=path):
                self.assertTrue(os.path.exists(os.path.join(PROJECT_DIR, path)))

    def test_scripts_run_directly_are_executable(self):
        for path in ["install.sh", "kiosk/kiosk.sh", "kiosk/update.sh", "tools/release.sh"]:
            with self.subTest(path=path):
                self.assertTrue(os.access(os.path.join(PROJECT_DIR, path), os.X_OK))

    def test_the_installer_takes_no_options(self):
        check = one(r'(?ms)^(if \[ "\$#" -gt 0 \]; then\n.*?^fi)$', self.install, "option check")
        run = lambda *args: subprocess.run(["bash", "-c", check, "install.sh", *args], capture_output=True, text=True)
        self.assertEqual(run().returncode, 0)
        for option in ["--skip-wifi", "--anything"]:
            with self.subTest(option=option):
                result = run(option)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("Unknown option", result.stderr)


class BlankCursorThemeTest(unittest.TestCase):
    def test_makes_an_invisible_pointer_theme(self):
        with tempfile.TemporaryDirectory() as home:
            script = os.path.join(PROJECT_DIR, "kiosk", "make_blank_cursor_theme.py")
            for _ in range(2):  # the installer reruns it on every update
                subprocess.run(["python3", script, "NoSuchTheme"], env={**os.environ, "HOME": home},
                               check=True, capture_output=True)
            theme = os.path.join(home, ".local", "share", "icons", "disney-parks-blank")
            with open(os.path.join(theme, "index.theme")) as f:
                self.assertIn("Name=disney-parks-blank\n", f.read())
            cursors = os.path.join(theme, "cursors")
            with open(os.path.join(cursors, "left_ptr"), "rb") as f:
                data = f.read()
            self.assertTrue(data.startswith(b"Xcur"))
            self.assertEqual(data[-4:], b"\0\0\0\0")  # its one pixel is fully transparent
            for name in ["default", "pointer", "hand2", "text", "wait"]:
                with self.subTest(name=name):
                    self.assertEqual(os.readlink(os.path.join(cursors, name)), "left_ptr")


if __name__ == "__main__":
    unittest.main()
