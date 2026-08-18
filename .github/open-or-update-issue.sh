#!/usr/bin/env bash
#
# Find-or-update, not open-a-new-one-every-night.
#
# A nightly job that files a fresh issue for the same ongoing condition is a job
# people mute inside a week, and a muted alarm is worse than no alarm because it
# still looks like coverage. So: one open issue per title. The first failure
# opens it; every failure after that comments on the same issue with the latest
# report, so the whole history of a drift lives in one thread and closing the
# issue is an explicit statement that it was dealt with. If it is closed and the
# condition comes back, a new issue opens -- that is a new event and deserves
# one.
#
# Matching is an exact title comparison over open issues rather than a
# `--search` query. The search index is eventually consistent, so a search would
# occasionally miss an issue opened minutes earlier and file a duplicate.
#
# The comparison runs inside gh's own embedded jq, which supports `env`, so the
# title is never interpolated into a jq program and titles containing quotes or
# backticks are safe. No external jq is required.
#
# Usage: TITLE=<title> open-or-update-issue.sh <body-file>
# Requires: gh, and GH_TOKEN carrying `issues: write`.
set -euo pipefail

body_file="$1"
: "${TITLE:?TITLE must be set}"

number="$(gh issue list --state open --limit 100 --json number,title \
  --jq 'map(select(.title == env.TITLE)) | .[0].number // empty')"

if [ -n "$number" ]; then
  gh issue comment "$number" --body-file "$body_file"
  echo "Commented on the existing issue #$number: $TITLE"
else
  gh issue create --title "$TITLE" --body-file "$body_file"
  echo "Opened a new issue: $TITLE"
fi
