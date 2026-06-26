"""Pure unit tests for local-tool gating (llm._tools_for) and the datetime tool.

No models, no app access — proves each keyword routes to the right LOCAL read tool
(email / texts / calendar / reminders / contacts / time), that email and iMessage no
longer collide, and that unrelated questions offer NO tool (so the small model can't
over-call and stall the spoken turn). Run:

    .venv/bin/python test_tools.py   (or plain `python3 test_tools.py`)
"""
import sys

from llm import _get_datetime, _tools_for


def names(text: str) -> set[str]:
    return {t["function"]["name"] for t in _tools_for(text)}


def main() -> int:
    failures = []

    def check(name, cond):
        if not cond:
            failures.append(name)

    # --- Each ask routes to its tool ---
    check("email last", "get_recent_emails" in names("what was my last email"))
    check("email inbox", "get_recent_emails" in names("how many emails are in my inbox"))
    check("email senders", "get_recent_emails" in names("who are the senders"))

    check("imessage text", "get_recent_imessages" in names("did anyone text me"))
    check("imessage from", "get_recent_imessages" in names("what was the last text from my wife"))
    check("imessage generic", "get_recent_imessages" in names("do I have any new messages"))

    check("calendar", "get_calendar_events" in names("what's on my calendar today"))
    check("meeting", "get_calendar_events" in names("when's my next meeting"))
    check("free", "get_calendar_events" in names("am I free at three"))

    check("reminders", "get_reminders" in names("what reminders do I have"))
    check("todo", "get_reminders" in names("what's on my to-do list"))

    check("contact number", "get_contact" in names("what's John's number"))
    check("contact email", "get_contact" in names("what's the email address for Sarah"))

    check("datetime time", "get_datetime" in names("what time is it"))
    check("datetime date", "get_datetime" in names("what's today's date"))
    check("datetime day", "get_datetime" in names("what day is it"))

    # --- Email and iMessage must NOT collide (the old combined-gate bug) ---
    check("text not email", "get_recent_emails" not in names("what was the last text from Sarah"))
    check("mail not imessage", "get_recent_imessages" not in names("read my last email"))

    # --- Unrelated questions offer NO tool (else the model over-calls and stalls) ---
    for q in ["what's two plus two", "what's the capital of France",
              "what's the weather today", "tell me a joke", "who won the game"]:
        check(f"no tool: {q}", names(q) == set())

    # --- The datetime tool speaks a real, current answer ---
    dt = _get_datetime()
    check("datetime speaks", dt.startswith("It is") and "20" in dt)

    if failures:
        print("FAIL:", ", ".join(failures))
        return 1
    print("OK  all tool-gate cases pass")
    return 0


if __name__ == "__main__":
    sys.exit(main())
