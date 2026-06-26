"""Unit tests for the voice-turn escalation gate (llm.resolve_escalation et al).

Pure — no models, no network. Proves that requests the local spoken model can't
do (research, web/news lookups, repo/build/PR queries) hand off to a full
HiveMatrix agent task AND speak an acknowledgment instead of a canned refusal,
while ordinary Q&A is answered live and never escalates. Run:

    .venv/bin/python test_escalation.py   (or plain `python3 test_escalation.py`)
"""
import sys

from llm import (
    ESCALATION_ACK,
    OUTBOUND_ACK,
    is_refusal,
    needs_research,
    resolve_escalation,
    wants_outbound,
    wants_task,
)


def main() -> int:
    failures = []

    def check(name, cond):
        if not cond:
            failures.append(name)

    # --- The three real refusals from the iOS screenshots ---
    # 1) "Take a research ... and give an assessment."
    t1 = "Mail B needs to be looked at for being able to delete messages. Take a research that and give an assessment."
    r1 = ('I cannot perform external research or access specific internal documentation for "Mail B" '
          "as it is not a standard, publicly defined service in my current context.")
    esc1, reply1 = resolve_escalation(t1, r1)
    check("case1 escalates", esc1)
    check("case1 speaks ack", reply1 == ESCALATION_ACK)
    check("case1 detected by refusal", is_refusal(r1))
    check("case1 detected by research", needs_research(t1))

    # 2) "Create a transcript of the top three AI news items of today ..."
    t2 = "Can you create a transcript of the top three AI news items of today for a YouTube video?"
    r2 = ("I can't create a transcript of today's top AI news because I don't have access to "
          "real-time information or current events.")
    esc2, reply2 = resolve_escalation(t2, r2)
    check("case2 escalates", esc2)
    check("case2 speaks ack", reply2 == ESCALATION_ACK)
    check("case2 detected by refusal", is_refusal(r2))
    check("case2 detected by research", needs_research(t2))

    # 3) "Go look up the last build of Hivematrix and see what PR request number was."
    t3 = "Go look up the last build of Hivematrix and see what PR request number was."
    r3 = "I don't have access to external tools to check the latest HiveMatrix build or pull request numbers."
    esc3, reply3 = resolve_escalation(t3, r3)
    check("case3 escalates", esc3)
    check("case3 speaks ack", reply3 == ESCALATION_ACK)
    check("case3 detected by refusal", is_refusal(r3))
    check("case3 detected by research", needs_research(t3))

    # --- Ordinary Q&A the local model handles: NO escalation, keep its reply ---
    t_ok = "What's two plus two?"
    r_ok = "Two plus two is four."
    esc_ok, reply_ok = resolve_escalation(t_ok, r_ok)
    check("plain qa does not escalate", not esc_ok)
    check("plain qa keeps reply", reply_ok == r_ok)

    # "What time is it?" is now answered LIVE by the local datetime tool (the Mac
    # clock), so it must NOT escalate. Only "time in <another place>" still hands off.
    t_time = "What time is it?"
    r_time = "It is Thursday, June 25, 2026, 5:50 PM EDT."
    esc_time, reply_time = resolve_escalation(t_time, r_time)
    check("time qa does not escalate", not esc_time)
    check("time qa keeps reply", reply_time == r_time)
    esc_tz, reply_tz = resolve_escalation("What time is it in Tokyo?", "It's mid-morning there.")
    check("time-in-place still escalates", esc_tz)
    check("time-in-place speaks ack", reply_tz == ESCALATION_ACK)

    # A friendly reply that merely contains "can't" mid-sentence must NOT be a refusal.
    check("not a refusal: enthusiasm", not is_refusal("I can't wait to help you with that!"))
    check("not a refusal: plain answer", not is_refusal("The capital of France is Paris."))

    # --- Reminder ask still escalates, but keeps the model's own acknowledgment ---
    t_rem = "Remind me to call the dentist tomorrow."
    r_rem = "Got it — I've added that to your HiveMatrix tasks."
    esc_rem, reply_rem = resolve_escalation(t_rem, r_rem)
    check("reminder escalates", esc_rem)
    check("reminder keeps model ack", reply_rem == r_rem)
    check("reminder is wants_task", wants_task(t_rem))

    # --- Outbound messaging MUST escalate (the local model can't send), even when
    # the model "politely acknowledged" — the bug was: said "added" but nothing spawned.
    for t_out in [
        "Message Joe that I'll be late.",
        "Send a text to my wife saying I'm on my way.",
        "Send her an email about the invoice.",
        "Can you text my wife I'm running late?",
        "Tell John that the meeting moved to three.",
        "Let Dave know I'll be late.",
        "Reply to Sam that it's approved.",
        "Email Sarah the quarterly report.",
    ]:
        r_out = "Got it — I've added that to your HiveMatrix tasks."  # the model's (wrong) self-ack
        esc_out, reply_out = resolve_escalation(t_out, r_out)
        check(f"outbound escalates: {t_out}", esc_out)
        check(f"outbound speaks send-ack: {t_out}", reply_out == OUTBOUND_ACK)
        check(f"outbound is wants_outbound: {t_out}", wants_outbound(t_out))

    # Reads about email/messages are NOT outbound — must not false-fire.
    for t_read in ["What does my email say?", "Do I have any new messages?",
                   "Read me my latest email.", "Send me the weather forecast."]:
        check(f"read not outbound: {t_read}", not wants_outbound(t_read))

    if failures:
        print("FAIL:", ", ".join(failures))
        return 1
    print("OK  all escalation cases pass")
    return 0


if __name__ == "__main__":
    sys.exit(main())
