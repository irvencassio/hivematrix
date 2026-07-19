#!/usr/bin/env bash
# Integrate a task branch into main — fast-forward ONLY, or refuse.
#
# Why this exists: agents produce work on their own branches, and something has
# to bring it back. Letting a model do that is the failure the operator kept
# hitting — a merge requires knowing the intent of BOTH sides, and the model
# authored only one. So integration is mechanical here: it either fast-forwards
# cleanly or it stops and hands the decision to a human. There is deliberately
# no conflict resolution, no rebase, no -X strategy, no "smart" anything.
#
# Usage:
#   scripts/integrate-task-branch.sh <branch>          # ff-only merge into main
#   scripts/integrate-task-branch.sh --list            # show hive/task-* branches
#   scripts/integrate-task-branch.sh <branch> --dry-run
#
# Exit codes: 0 integrated · 1 usage · 2 preflight failed · 3 not fast-forward
set -euo pipefail

cd "${HIVEMATRIX_REPO:-$(git rev-parse --show-toplevel)}"

die() { echo "✗ $*" >&2; exit "${2:-2}"; }

if [ "${1:-}" = "--list" ]; then
  # Matches hive/* broadly, not just hive/task-*. Agents following AGENTS.md name
  # their own branches (hive/remove-new-task-button), and the narrower pattern
  # made the one genuinely stranded branch invisible to the tool whose entire job
  # is finding stranded branches — its work sat unmerged for a day while the
  # operator asked for it three times.
  echo "Task branches not yet in main:"
  git for-each-ref --format='%(refname:short)' refs/heads \
    | grep -E '^(hive/|fix/|feat/)' \
    | while read -r b; do
        n=$(git rev-list --count "main..$b" 2>/dev/null || echo 0)
        [ "$n" -gt 0 ] && printf '  %-45s %s commit(s) ahead\n' "$b" "$n"
        : # keep the loop body truthy so a clean repo does not exit 1 under set -e
      done
  exit 0
fi

BRANCH="${1:-}"
[ -n "$BRANCH" ] || die "usage: $0 <branch> [--dry-run] | --list" 1
DRY_RUN=0; [ "${2:-}" = "--dry-run" ] && DRY_RUN=1

git rev-parse --verify --quiet "$BRANCH" >/dev/null || die "no such branch: $BRANCH"

# Refuse to touch a dirty tree: a shared checkout may hold another task's
# uncommitted work, and merging over it is exactly how that gets destroyed.
[ -z "$(git status --porcelain)" ] || die "working tree is dirty — commit or stash first (it may hold another task's work)"

AHEAD=$(git rev-list --count "main..$BRANCH")
BEHIND=$(git rev-list --count "$BRANCH..main")
echo "branch:  $BRANCH"
echo "ahead:   $AHEAD commit(s) not in main"
echo "behind:  $BEHIND commit(s) in main not on branch"
[ "$AHEAD" -gt 0 ] || die "nothing to integrate" 0

# A branch that is behind main cannot fast-forward. Say so plainly and stop —
# do NOT rebase it automatically; that rewrites an agent's history and is where
# silent corruption starts.
if [ "$BEHIND" -gt 0 ]; then
  cat >&2 <<MSG
✗ Not fast-forwardable: $BRANCH is $BEHIND commit(s) behind main.

  This is a human decision, on purpose. Options:
    • rebase it yourself:  git rebase main $BRANCH   (then re-run this)
    • or review and merge manually if the histories genuinely diverged.

  This script will not rebase or resolve conflicts for you.
MSG
  exit 3
fi

echo "$AHEAD commit(s) to integrate:"
git log --oneline "main..$BRANCH" | sed 's/^/  /'

if [ "$DRY_RUN" = "1" ]; then echo "(dry run — nothing changed)"; exit 0; fi

git checkout main >/dev/null 2>&1 || die "could not check out main"
git merge --ff-only "$BRANCH" || die "fast-forward merge refused" 3
echo "✓ integrated $BRANCH into main (fast-forward)"
echo "  next: verify, then ./scripts/developer-id-release.sh --release"
