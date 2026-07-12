"""Regression test for _parse_due's month/day date parsing (mirrors the TS
suite in src/lib/orchestrator/pim-tools.test.ts — keep the two in sync).

    .venv/bin/python test_parse_due.py
"""
import sys
from datetime import datetime

from llm import _parse_due

NOW = datetime(2026, 7, 10, 14, 0, 0)  # Friday July 10 2026, 2:00 PM


def main() -> int:
    # Relative phrases (pre-existing behavior — regression guard).
    d = _parse_due("in 20 minutes", NOW)
    assert (d - NOW).total_seconds() == 20 * 60, d

    d = _parse_due("tomorrow at 5pm", NOW)
    assert (d.day, d.hour, d.minute) == (11, 17, 0), d

    d = _parse_due("at 5", NOW)
    assert (d.day, d.hour) == (10, 17), d

    d = _parse_due("friday at noon", NOW)
    assert (d.day, d.hour) == (17, 12), d

    # The reported bug, at the function level: "19" must not become the hour.
    d = _parse_due("July 19 at 3 PM", NOW)
    assert (d.month, d.day, d.hour, d.minute) == (7, 19, 15, 0), d

    # A named month+day wins over a weekday word.
    d = _parse_due("Saturday July 19 at 3pm", NOW)
    assert (d.month, d.day, d.hour) == (7, 19, 15), d

    # Numeric M/D and "the Nth" forms.
    d = _parse_due("7/19 at 3pm", NOW)
    assert (d.month, d.day, d.hour) == (7, 19, 15), d
    d = _parse_due("the 19th at 3pm", NOW)
    assert (d.month, d.day, d.hour) == (7, 19, 15), d

    # A month+day that already passed this year rolls to next year.
    d = _parse_due("July 5 at 9am", NOW)
    assert (d.year, d.month, d.day, d.hour) == (2027, 7, 5, 9), d

    # Unparseable input.
    assert _parse_due("someday soon maybe", NOW) is None
    assert _parse_due("", NOW) is None

    print("OK — all _parse_due cases passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
