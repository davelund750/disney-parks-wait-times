# Shortcuts for running the app on your own computer. On a kiosk, systemd runs
# the server instead (see install.sh).
#
#   make start     start the server in the background
#   make stop      stop it
#   make restart   stop, then start
#   make status    say whether it's running
#   make logs      follow the server's output
#   make run       run it in this terminal instead (Ctrl+C stops it)
#   make test      run all the tests
#   make release VERSION=1.2.0   publish a release (see tools/release.sh)
#
# PORT, DPWT_DATA_DIR, DPWT_FAKE_OFFLINE and the other server settings pass
# through, e.g. `make start PORT=8001` or `make start DPWT_FAKE_OFFLINE=1`.

PORT ?= 8000
export PORT

# The background server's process ID and output, kept out of git.
RUN_DIR := .run
PID_FILE := $(RUN_DIR)/server-$(PORT).pid
LOG_FILE := $(RUN_DIR)/server-$(PORT).log

# True while the process in the PID file is alive.
RUNNING = [ -f $(PID_FILE) ] && kill -0 "$$(cat $(PID_FILE))" 2>/dev/null

.PHONY: help start stop restart status logs run test release

help:
	@sed -n '4,11p' Makefile | sed 's/^# *//'

start:
	@if $(RUNNING); then \
		echo "Already running at http://localhost:$(PORT) (process $$(cat $(PID_FILE)))."; \
	else \
		mkdir -p $(RUN_DIR); \
		nohup python3 server/server.py > $(LOG_FILE) 2>&1 & echo $$! > $(PID_FILE); \
		sleep 1; \
		if $(RUNNING); then \
			echo "Running at http://localhost:$(PORT). Output: $(LOG_FILE)"; \
		else \
			echo "The server didn't start:"; cat $(LOG_FILE); rm -f $(PID_FILE); exit 1; \
		fi; \
	fi

stop:
	@if $(RUNNING); then \
		kill "$$(cat $(PID_FILE))" && echo "Stopped the server on port $(PORT)."; \
	else \
		echo "Not running on port $(PORT)."; \
	fi
	@rm -f $(PID_FILE)

restart: stop start

status:
	@if $(RUNNING); then \
		echo "Running at http://localhost:$(PORT) (process $$(cat $(PID_FILE)))."; \
	else \
		echo "Not running on port $(PORT)."; \
	fi

logs:
	@tail -f $(LOG_FILE)

run:
	python3 server/server.py

test:
	node --test tests/logic.test.js
	TZ=Europe/London LANG=en_GB.UTF-8 node --test tests/logic.test.js
	python3 -m unittest discover -s tests
	bash tests/test_update.sh
	bash tests/test_release.sh
	@if command -v shellcheck >/dev/null; then \
		shellcheck install.sh kiosk/kiosk.sh kiosk/update.sh tools/release.sh tests/test_update.sh tests/test_release.sh && echo "shellcheck: clean"; \
	else \
		echo "shellcheck isn't installed; skipping the shell script lint."; \
	fi

release:
	@tools/release.sh "$(VERSION)"
