# MailBee Trusted Sender Auto-Send Design

## Problem

MailBee setup allowlists individual sender addresses, but the ingress trust classifier only marked a sender as `trusted` when the address was known and the sender domain was also listed in `mailbee.trustedDomains`. A known sender without that domain hint became `external`, so HiveMatrix drafted a reply for approval instead of allowing autonomous send.

## Approaches

1. Keep requiring both known sender and authenticated domain.
   - Strict, but it does not match the setup UI expectation that safe senders can auto-reply.
2. Treat an explicitly known sender as trusted unless content safety checks override it.
   - Matches MailBee setup and preserves prompt-injection and risky-attachment blocks.
3. Add a second safe-sender setting for "known but draft only."
   - More flexible, but larger UI/config scope than this bug requires.

## Selected Design

Use approach 2. A sender that appears in MailBee's allowed/paired identity list is `trusted` even when its domain is not separately listed in `mailbee.trustedDomains`. Prompt-injection signals and risky executable/script attachments still force `suspicious`, and suspicious mail is never auto-send eligible.

## Completion Delivery

Trusted MailBee tasks are not done at "drafted an answer." When a trusted task completes with a final answer and no user-input request, HiveMatrix sends that answer through Apple Mail to the original sender, records the delivery result in `output.mailbee`, and leaves non-trusted or suspicious tasks in review for human approval.

## Trusted Attachments

For trusted senders, non-risky attachments are trusted as sender-provided content and may be read to answer the email. Executable or script-like attachments still force the whole message to `suspicious`, which disables auto-send.

## Verification

- Unit test a known sender without authenticated domain as trusted and auto-send eligible.
- Unit test route descriptions now say the sender is trusted for known senders.
- Keep suspicious override tests.
- Unit test trusted task descriptions do not label trusted attachments as untrusted.
- Unit test trusted MailBee completion sends once through Apple Mail and records the result.
- Unit test non-trusted, suspicious, or needs-input completions do not send.
- Run repository verification gates before publishing the updater release.
