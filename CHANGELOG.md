# Changelog

Release notes for HiveMatrix. Newest first. Auto-maintained by `scripts/release.mjs`; the in-app **Settings → Release notes** reads the same data (`src/lib/version/changelog.ts`).

## v0.1.251 — 2026-07-23

Fixes Browser Lane refusing jobs on the wrong site's behalf. A plain Google search was blocked with 'LinkedIn is configured read-only' — because sites that sign in through Google list Google's domains so the login redirect works, and Browser Lane was treating that as though LinkedIn owned Google. Any site that signs in with Google (LinkedIn, YouTube) could block unrelated work the same way. A site is now only considered the owner of a domain when it's actually that site's own address. Read-only protection is unchanged — it still applies, just to the right site.

## v0.1.250 — 2026-07-23

Background tasks can now actually use HiveMatrix's own tools. Until now a task could only send email and iMessage — it had none of the tools the chat assistant has, so any job that needed to drive your Mac, open a browser, or read your brain would report that the tool did not exist and quietly finish having done nothing. This is why Browser Lane's fallback never worked: it told the task to drive the browser with a tool the task did not have. Tasks now get the same 23 lane tools the assistant has, with the same permission checks applied on the server side.

## v0.1.249 — 2026-07-23

Developer ID release

## v0.1.248 — 2026-07-23

Finished tasks now land on main by themselves. Previously a task ended with its work committed on its own branch, waiting for you to click Archive before anything merged — so completed work sat somewhere you never looked. With the new 'Auto-merge finished tasks to main' setting (Settings → Features), a task that finishes cleanly is fast-forwarded into main and pushed automatically. The safety checks are unchanged: it only ever fast-forwards (never rewrites main or resolves a conflict), it typechecks after merging and undoes the merge if that fails, and it refuses if your working tree is dirty. Nothing that failed, or that is still waiting on your input, is ever merged.

## v0.1.247 — 2026-07-22

The header usage meters (5h, 7d, and ctx) are now longer bars with tick marks at each segment boundary — one mark per hour on 5h, per day on 7d, and quarters on ctx — so they're readable at a glance instead of a tiny dash. The 7-day bar now fills by how much of your weekly budget you've actually used (days-worth consumed) rather than by which day of the week it is, and it turns red when you're burning faster than one day's share per day — so a hot week shows up early. (This ships the 0.1.246 usage-bar work, which was committed but never published to the update feed.)

## v0.1.246 — 2026-07-22

The header usage meters (5h, 7d, and ctx) are now longer bars with tick marks at each segment boundary — one mark per hour on 5h, per day on 7d, and quarters on ctx — so they're readable at a glance instead of a tiny dash. The 7-day bar now fills by how much of your weekly budget you've actually used (days-worth consumed) rather than by which day of the week it is, and it turns red when you're burning faster than one day's share per day — so a hot week shows up early.

## v0.1.245 — 2026-07-22

Fixes the in-app assistant not being able to see your tasks. When you asked it about a task, it would fail with an 'unknown tool' error behind the scenes and then guess — sometimes wrongly — at what the task was doing. It can now read the board (list your tasks and look one up) correctly. Also an internal test-tooling cleanup so future UI checks are more reliable.

## v0.1.244 — 2026-07-22

Tasks now run with no dollar budget cap by default, matching Claude Code itself — a task runs until it's done rather than getting cut off mid-work at an arbitrary dollar amount. Your usage limits and a per-task time limit still bound anything that runs away, and you can still set a spending cap on an individual task if you want one. Also: tasks that use smart model routing now read 'Role-routed' (Opus for thinking, Sonnet for coding) instead of the confusing 'mixed', so it's clear the top-level work runs on Opus.

## v0.1.243 — 2026-07-22

Fixes the last dead spots in the Tools panel. Most importantly, opening Tools 'cold' (right after launch, before things finished loading) showed no Run buttons at all — now they always appear. Also, Copy and Publish in a skill's window were quietly reporting success in a side column you might not be looking at; that feedback now lands right where you clicked. Backed by a new set of automated UI tests that click every control the way you would.

## v0.1.242 — 2026-07-22

Tasks that hit a real problem now give up faster. A failing task used to retry 5 times before failing — for the failures that actually happen (a sign-in or config problem), that's just four extra rounds of waiting on an outcome that won't change. Now it retries once, then fails with a clear reason. Genuine rate-limits are unaffected — those still wait for your usage window to reset.

## v0.1.241 — 2026-07-22

Fixes tasks failing to run and the repeated 'authorize in browser' prompts. On a normal install the task runner wrongly decided you were signed out — even though you weren't — then tried to fix it by opening the Claude sign-in page in your browser, twice, on a loop that never stopped. Tasks now use the same sign-in everything else does and just run. If a task ever does hit a real auth problem, it fails with a clear message telling you to re-authenticate in Settings, instead of hijacking your browser.

## v0.1.240 — 2026-07-22

Fixes the skill window's own buttons doing nothing. Opening a tool from Tools gave you the right window, but Run, View, Copy, Publish and Delete inside it were all dead — the window knew which tool it was showing, its buttons did not. Run now launches the task and View shows the skill text.

## v0.1.239 — 2026-07-22

Fixes every Run button in Tools doing nothing. The previous release stopped dead buttons from appearing, but the ones that remained still could not open — the button handed the skill's name to the opener web-encoded, in a form the opener could not read, so all 110 of them failed silently. Also fixes Tools rows never expanding when you click them, and the params and source tooltips showing encoded gibberish instead of plain text.

## v0.1.238 — 2026-07-22

Fixes every Run button in Tools doing nothing. The previous release stopped dead buttons from appearing, but the ones that remained still could not open: the button handed the skill's name to the opener in a web-encoded form the opener could not read, so all 110 of them silently failed. Also fixes Tools rows never expanding when clicked, and the params and source tooltips showing encoded gibberish like text%2C%20domains instead of plain text.

## v0.1.237 — 2026-07-22

Fixes the Run buttons in Tools doing nothing. Clicking Run on almost any command silently failed: the button was built from the command's own name, but the catalog folds a folder-skill into its brain-skill twin when both exist, so the name it looked up was not there and nothing opened. Run now checks what the catalog actually holds before offering the button, so a button that cannot open no longer appears at all.

## v0.1.236 — 2026-07-22

Tools can now run things. Every skill and command in the Tools list gets a Run button that opens the parameter picker, so you no longer have to go to the right sidebar to run anything. Agent-only tools stay unrunnable on purpose — those are what the model reaches for, not something you click. Also fixes the Integrate card failing with a raw 'not a git repository' error: its project picker offered 'HiveMatrix (this repo)', which resolved to wherever the app happened to be running from rather than the repo — for an installed app that is your home folder, which is not a repository. It now lists real project paths and defaults to HiveMatrix.

## v0.1.235 — 2026-07-22

Everything now runs on one model by default. The old routing split work across three tiers that were built for a local model that no longer exists, so fifteen named concepts resolved to two Claude models and the seams between them were where bugs kept appearing. Chat also ignored your Operational and Chat setting entirely — it reported Sonnet while the setting read Haiku, and choosing Opus changed nothing — so that now works, and you can pin a single conversation with '/model opus' and release it with '/model default'. Tools can now run brain skills the same way it runs commands: parameters are clickable pills that reveal a text box, instead of a row of plain inputs on one half of the catalog and pills on the other. The left sidebar now holds Approvals at the top where a blocked task cannot be missed, and Scheduled beneath, and collapsed sections match the nav buttons instead of looking like stray headings. The header drops the green usage readout and the yellow toggle that drove it, since both meters already carry that detail in a tooltip. Also fixes the context gauge capping every model at 200k regardless of what it could actually hold, hidden folders like .history being offered as projects, and removes a frontier-review-debt mechanism whose trigger could never fire.

## v0.1.234 — 2026-07-22

Fixes the header's context meter hiding how full your conversation is. The number, the token counts, and the fact that older turns get folded into a summary automatically past 75% all lived inside a hover tooltip that frequently refused to appear — every other meter in that row shows its reading as plain text. The context meter now shows its percentage beside the bar. Memory's 'Loaded into every task' panel opened on an arbitrary project instead of one you chose, and showed a size limit next to files that were not there; it now remembers your pick and says plainly that it means a repository. The 'What works right now' panel was missing four of your six lanes — Mail, Message, Review and Memory were running but described nowhere, so there was no way to tell whether mail keeps working when you go offline. It does: Mail, Message and Memory all run locally and keep working, while Review waits for connectivity because it needs a model. That panel also stopped counting a rule as a working capability.

## v0.1.233 — 2026-07-21

Fixes tasks running architecture work on the coding model. Every task defaulted to Mixed, and Mixed was hardcoded to route as final implementation no matter what the work actually was — so the Thinking, Operational and Writer settings never reached a task at all, and only Coding did. Design and architecture work silently ran on the coding model. Tasks now route by the agent's own role, and a CTO role is back: architecture, system design and security posture get the thinking model with full developer tools, while plain implementation stays where it was. Settings, Models could also show '(no models configured)' with empty dropdowns while the server was returning every model — a failed load rendered as settled fact, and you could not change the model even though nothing was wrong. Tasks used to open with a call to a skill that is not installed, wasting their first turns before reaching the actual work. Memory gains a 'Loaded into every task' panel showing exactly which files reach a task's prompt, how big they are, and whether any are being silently cut off. Canopy and other MCP servers no longer show as offline when they are registered and working. The lane panel is now grouped by what each entry is, so a lane's capabilities sit under the lane instead of beside it. Also fixes a bring-your-own local model endpoint being erased from your settings on every restart.

## v0.1.232 — 2026-07-20

Fixes tasks failing to sign in to Claude while chat kept working. Each agent role — developer, researcher, QA, COO — was accidentally being given its own separate Claude sign-in, created silently the first time that role ran and never refreshed afterwards. Once those expired, every task failed with an authentication error even though chat, the terminal and the browser were all still signed in, because those use the machine's normal sign-in. Tasks now use that same sign-in. Settings, Models also gains a Re-authenticate button that is always available, since a sign-in can be expired while the status still looks healthy, and failures of this kind now retry and say plainly what to do instead of stopping with an unexplained error.

## v0.1.231 — 2026-07-19

Fixes typed chat on your phone running on the settings meant for spoken replies. Chat on iPhone was being treated as a voice surface, so it got the fast-but-small model with a ninety-second limit — the same budget as a two-second reply on your watch — even though it is where the longest requests get made. Typed chat now gets the stronger model and a fifteen-minute budget on the phone, exactly like the desktop, while voice and watch keep the quick settings so spoken replies stay snappy.

## v0.1.230 — 2026-07-19

Chat can now finish the work you give it. It could not write files at all — so 'research this and make me a brain doc' was impossible, and it told you 'tool limitations' — and it ran on one budget sized for a watch reply: three minutes and twelve steps, for every surface. Typed chat now runs on a stronger model with fifteen minutes and forty steps, while voice and watch keep the fast model and a short clock so spoken replies stay quick. Chat can write brain docs directly, and it now hands multi-step or code work to a background task immediately instead of burning the clock and losing everything. The '+ New task' button is gone; Chat is the one way to start work. Also fixes the updater telling you that you were up to date for about twenty-five minutes after every release.

## v0.1.229 — 2026-07-19

Fixes Chat failing to use its own tools. The assistant was being told to call tools by one name while it was actually given another, so calls came back as 'No such tool available' and it fell back to describing the work instead of doing it — asking it to change something in HiveMatrix, look something up in your brain docs, or set a reminder could quietly go nowhere. Also fixes escalations to a background task not reporting the task they created, so Chat could not tell you which task it had opened.

## v0.1.228 — 2026-07-19

Adds a Restart daemon button in Settings → About, with the daemon's real running version next to the installed one. The background daemon runs under launchd and keeps running when you quit the app, so quitting and reopening never restarted it and neither did reloading the window — and the version shown was read from the installed app on disk rather than the code actually running, so it reported the new version while the old one was still live. There was no honest way to tell whether an update had finished. The Finish update button also did nothing in the one situation it was offered: the app was already installed and only the daemon was behind, but the button re-ran the installer, found nothing to do and reported everything was up to date. It now restarts the daemon. Restarting warns first if tasks are still running, since it kills them.

## v0.1.227 — 2026-07-19

Tasks that finished after you replied to a question no longer sit in Review still asking for a reply — a question you had already answered was being re-read as unanswered on every later run, so the task looked stuck no matter how much work it had done. The 5-hour, 7-day and conversation-context meters are now one consistent, larger set in the title bar, and the context meter is always visible instead of appearing only once the conversation was already half full. The four proactive rituals — Day Brief, Capability Ratchet, Weaver Audit and Pattern Nudges — finally have real controls in Settings, with a Run-now button each; before this they could only be turned on by hand over the API. Removes a small unlabelled box beside the theme switch that looked like a broken meter and did nothing, and makes the Chat panel's New button readable instead of grey 11px text.

## v0.1.226 — 2026-07-19

Fixes the conversation-fullness meter, which was reading about double the real figure — a brand-new chat showed half full after a single message, and one conversation reported more tokens than the model's window can physically hold. The cached part of the conversation was being counted twice. Beyond the misleading number, this meant older messages were being summarised away at roughly half the intended point, discarding conversation that still fit comfortably. Existing conversations correct themselves on your next message.

## v0.1.225 — 2026-07-19

Fixes the New button in Chat, which did nothing at all. Clicking it silently failed — no confirmation, no reset — because it used a system dialog this app's window doesn't support, so the one way to escape a full conversation was dead exactly when the meter read 100%. It now asks for confirmation properly and starts a fresh thread. The Delete button on COO routing rules was broken the same way and is fixed too.

## v0.1.224 — 2026-07-19

Two fixes that were finished but never shipped. Tasks that ask you a multiple-choice question now show the answers as buttons in the reply panel — before, a task could ask 'which of these?' and give you nowhere to click, which is why some tasks looked stuck when they were simply waiting. And if the goals list is ever empty, HiveMatrix now rebuilds it from your GOALS.md at startup instead of showing an empty Goals panel and quietly skipping the daily accountability check, which is what happened after a goals wipe earlier this month.

## v0.1.223 — 2026-07-19

Chat no longer runs out of room without warning. Flash conversations never expired and the desktop, phone and watch all share one thread, so it grew until the assistant announced mid-reply that it was 'at session end' — and the console had no way to start a fresh conversation at all. Chat now shows how full the conversation is once it passes the halfway mark, folds older turns into a running summary automatically past 75% so the thread keeps working instead of failing, and offers a New button to start clean. A context overflow is also now recognised for what it is: it was previously misread as an expired session, silently retried, and logged as the wrong cause, which is why this was hard to see coming. Also removes a dead /update/check route that was breaking the build.

## v0.1.222 — 2026-07-18

Tasks you escalate from chat now reach the right repo even when you don't spell it exactly like the folder. Asking for work 'in ironsixty' was filed against HiveMatrix itself with no project directory, so the coding agent opened the wrong checkout, could not find the files it was asked to change, and the task failed outright — the second time in a day. The cause was that only the literal hyphenated directory name resolved: the folder is iron-sixty while the product, and what you actually type, is IronSixty. Project names now match regardless of hyphens, underscores, spaces or capitalisation, so ironsixty, IronSixty and Iron Sixty all reach the same checkout, while a genuinely unknown name still fails cleanly rather than being force-matched to something close.

## v0.1.221 — 2026-07-18

Fixes the update indicator going dark while an update really was published. The version check cached a failed fetch exactly like a successful one, so a single transient network timeout pinned 'no update available' for a full minute and every poll in that window re-served the stale failure — which is why 0.1.220 looked like it was never staged even though it was live on the feed the whole time. Failed checks now expire in seconds so the next poll retries, while successful checks keep their normal cache. Also records the outstanding work from this run in docs/open-items-2026-07-18.md, including three debugging facts that each cost real time: the exact launch arguments of a run are stored on the task itself rather than inferred from the process list, browser sign-in recipes live under a differently-named field than you would guess, and building the iOS app for the simulator fails on the embedded watch target.

## v0.1.220 — 2026-07-18

Agents no longer clobber each other's work. Everything here runs against one shared checkout — you, and every task agent — and finished-but-unreviewed work routinely sits uncommitted in it. A blanket 'git add -A' therefore sweeps someone else's feature into an unrelated commit under an unrelated message, which is exactly what happened: roughly 900 lines of a finished console feature were absorbed into a harness fix and would have shipped inside an unrelated release, caught only because the release script refuses to build off a non-main branch. Agents are now told, in the file every coding agent reads and again in the task itself, to stage only the files they touched, to commit their own work before finishing so it cannot be swept, and never to merge or resolve conflicts. Integration is now a mechanical fast-forward-only step that refuses on a dirty tree or a diverged branch and hands the decision back to you, because a merge needs the intent of both sides and an agent only ever authored one.

## v0.1.219 — 2026-07-18

Two harness fixes found by inspecting a live run rather than trusting the tests. The adaptive effort default shipped two releases ago was never actually reaching the CLI: the spawn path handed it an already-resolved thinking mode, which collapses 'auto' to maximum reasoning, so every task still launched pinned at max — the exact slowness that change was meant to remove. Confirmed against a running agent started seconds after the previous release, which still carried the max flag. The unit tests had passed throughout because they exercised the argument builder directly and nothing covered the real call site; there is now a guard on the call site itself. Separately, the delegation instruction hardcoded specific model tiers, telling a Sonnet-routed agent that it was Opus and should hand work to Sonnet subagents — i.e. to itself. It is now model-agnostic, since the router chooses the tier and any hardcoded name can only drift from reality.

## v0.1.218 — 2026-07-18

Tasks you escalate from chat now land in the repo you actually named. A request that explicitly said 'in hivematrix-ios' was filed against the daemon repo instead, which means the coding agent opens the wrong checkout, cannot find the files it was asked to change, and either fails or edits the wrong project — silently wasting the run. Flash must now pass exactly the repo you name and cannot substitute a similarly-named one. Also drops a stale example that pointed at the deprecated standalone watch repo, which can no longer ship; the watch app lives inside the iOS app.

## v0.1.217 — 2026-07-18

Approvals are now actionable from the lock screen and the wrist. The daemon tags approval pushes with an actionable category, which is what makes iOS render Approve/Deny directly on the notification instead of plain text you have to unlock and chase. Paired with HiveMatrix iOS build 62 (uploaded to TestFlight): the phone app previously had no notification delegate at all, so a push arriving while the app was open was silently dropped and tapping one did nothing — now taps deep-link straight to the approval queue and the Approve/Deny buttons resolve without opening the app. The Watch gains an approvals screen (its API had been wired but unreachable) and a complication that shows how many approvals are waiting, so the watch face itself tells you when the loop is blocked on you.

## v0.1.216 — 2026-07-18

Live agent output now actually streams to the console. AgentManager broadcast every text delta, tool event and error to a listener that was never wired up — the field stayed the empty no-op it was initialised with, so all live output was discarded and the console's only way to learn an agent had produced anything was its 5-second backstop poll. That single dead wire is why generation appeared to arrive in 5-second chunks regardless of how fast the model streamed; it was never a rendering or model problem. Agent text now pushes an event the console already listens for, on the existing 500ms flush rather than per token, so first visible output lands in about half a second instead of up to five, without a refresh storm and with the broadcast failure-isolated so it can never break a run.

## v0.1.215 — 2026-07-18

Message Lane sends again, and Apple sign-ins actually complete. Message Lane: two failures were hiding behind one generic error — an intermittent macOS -1719 where Messages' account list enumerates empty (added a chat-id recovery path using the service-agnostic 'any;-;' prefix), and an unanswered Automation consent prompt after an app update that surfaced as a silent 30s timeout (send failures now distinguish TIMEOUT from a real AppleScript error and keep stderr/exit code, so they can never go opaque again). Browser Lane: credential fill now focuses and blurs the field, which is what Apple ID requires before it will enable its Continue button — a filled email next to a dead Continue button was the symptom. Apple Developer gains a login recipe (Apple's ID form lives in a cross-origin iframe on idmsa.apple.com, now allow-listed). Claude Code generation: 'auto' effort no longer collapses to maximum reasoning — the CLI picks its own depth per turn like a direct session, with explicit tiers still available per task, and the delegate-to-subagents directive now applies only to broad self-planning work instead of every trivial task. Time-to-first-token is now recorded per run. One morning message instead of two: the persona-voice brief now carries the Day Brief's real numbers rather than sending a separate robotic contract. Task creation: escalate_to_task no longer invents scope — a spec it wrote had fabricated test targets, re-proposed already-shipped work, and contradicted the standing human-click-only credential rule.

## v0.1.214 — 2026-07-18

Faster, less-blocking Claude Code generation and a warmer, more reachable assistant. The coding harness no longer runs its approval hook on read-only tools (Read/Edit/Grep/etc. skip it entirely — verified against the Claude CLI; Bash and MCP tools are still gated exactly as before), reads the autonomy dial live so flipping to Autonomous unblocks an already-running agent on its next tool call, and polls approvals 5x faster. Flash now carries an always-on warm, direct voice (deferring to your SOUL/IDENTITY persona) and writes plain text to iMessage/Mail instead of leaking markdown into text bubbles, and it learns how you like to be talked to over time. Approvals and stuck tasks now push to your phone and watch over APNs/FCM even when the app is closed. The heartbeat now sees your live console/voice conversation so it stops nagging about things you already handled. New Task gains a per-task Effort selector (run simple tasks fast without touching the global default) and Cmd/Ctrl+Enter to submit.

## v0.1.213 — 2026-07-18

Browser Lane can now fill logins that live in a cross-origin iframe (App Store Connect / Apple Developer, which sign in through Apple ID on idmsa.apple.com) — the credential is origin-checked against the iframe's real WebKit origin before anything is typed, so it only fills where you allow-listed. Also adds real browser navigation: back / forward / reload-stop with keyboard shortcuts, a load progress bar, copy-URL, open-in-default-browser, and trackpad swipe-to-navigate + pinch-to-zoom.

## v0.1.212 — 2026-07-17

Keep one browser alive so sessions survive site switches — signing into a site (Apple ID / App Store Connect especially) no longer logs you out when you switch to another site. Switching sites previously rebuilt the WebKit view and dropped in-memory session cookies and auth state; the browser is now a single persistent instance.

## v0.1.211 — 2026-07-17

Browser Lane rebuilt around Canopy's layout: the left sidebar is now the site list itself (session dot, agent-access badge, + add, and a right-click menu for Open / Sign in / Readiness / Edit / Duplicate / Command Log / Delete), a Command Log right panel replaces the Traces screen with per-site audit history and Human/Agent/Blocked/Failed/Security filters, and the remaining chrome moved to toolbar icons that light blue for whichever pane is showing. Multi-step sign-ins now work end to end: an optional per-site login recipe (a fixed click/clickText/waitFor/wait/fill/submit vocabulary, never a script) can drive an OAuth handoff like Samsung Knox, with username/password placeholders substituted natively from the Keychain, an origin check before every credential step, and no reachability from the agent side. HeyGen is no longer hardcoded anywhere — every site is user-defined. Also fixes: a Codable change that would have wiped saved sites, a login runner that deallocated mid-run, stale allowlist checks, unlit toolbar icons, a bottom-anchored Readiness screen, Tab not moving between form fields, and silent read-only refusals that now appear in the log.

## v0.1.210 — 2026-07-16

Left sidebar consolidation (lanes/agents setup + monitoring, Board collapse, Brain renamed Memory, Overview removed); console: taller composer + prompt snippets, Tools search fixes, gold active usage toggle; Browser Lane: read/write permission gating + Canopy-parity audit filters, and the Desktop fallback is now driven by Claude instead of a dead local-model gate; tasks: resolve project by name instead of a homedir guess, and the runaway budget backstop raised $10 to $25

## v0.1.209 — 2026-07-16

Browser Lane auto-enables desktop fallback on first authenticated site; Goals auto-seed from persona/GOALS.md; voice fix (no say-voiced chunk on Kokoro failure); console scroll-position restoration for Chat/Tools/Goals

## v0.1.208 — 2026-07-16

Task board: batch grouping + verification-verdict badges; opt-in per-task git worktree isolation (off by default); Tools window search + parameter discovery + run

## v0.1.207 — 2026-07-15

Flash can now inspect its own tasks: ask it 'why did this task fail?' and it reads the task's error + activity log itself (get_task), or 'what's failed/running?' for the board (list_tasks) — no more asking you to screenshot the error.

## v0.1.206 — 2026-07-15

Flash chat: paste (Cmd+V) or drag-and-drop an image into the message box — previously only the file picker worked, so pasted screenshots were silently dropped and the assistant couldn't see them.

## v0.1.205 — 2026-07-15

Self-improvement loop is now opt-in (default off, toggle in Settings → Features) — it can no longer reinstall or resurrect itself across app updates.

## v0.1.204 — 2026-07-15

Message Lane setup fix: the FDA step now shows access you've already granted (it was checking passively and hiding it); restore the allowlist after an update with a backlog-replay guard; home banner for degraded features; voice reads full failed-task errors.

## v0.1.203 — 2026-07-15

Message Lane: reveal/restart the real chat.db daemon for Full Disk Access + honest denied copy; DB self-heal restores goals wiped by an update; board status colors (needs-input amber / ready-for-review green); voice approve/deny verb-less follow-up.

## v0.1.202 — 2026-07-15

Fix duplicate iMessage sends: one delivery per recipient per run (heals the 2026-07-14 daily-audit double-send); native task execution runs the CLI like a direct Claude Code session (Opus plans, Sonnet builds).

## v0.1.201 — 2026-07-13

Developer ID release

## v0.1.200 — 2026-07-12

Asking about a long document in chat no longer spins up a background task just to finish reading it — the assistant now pages through the whole document directly and answers.

## v0.1.199 — 2026-07-12

Voice replies now speak in full — long, multi-paragraph answers (like your solo-founder goals) no longer cut off after the first paragraph, and stay in one consistent voice. Plus: HiveMatrix now texts you when a reminder comes due, so you never miss one even if you don't see the alarm.

## v0.1.198 — 2026-07-12

Voice reminders now actually work. Saying 'remind me to call the dentist in 5 minutes' (or any 'remind me…' / 'set a reminder…') over voice now sets a REAL reminder on your devices instead of silently queuing a do-nothing task. Same reliable behavior in chat.

## v0.1.197 — 2026-07-12

Fixes 'remind me to X in 5 minutes' (and calendar events) failing silently in chat and streaming voice. The reminders/calendar helper was rejecting timestamps that carried milliseconds, so every timed reminder quietly failed and voice fell back to queuing a do-nothing task. Reminders and events with a time now set reliably.

## v0.1.196 — 2026-07-12

The assistant can now SEE photos — attach one in chat (📎) or text one over iMessage and it describes/acts on it. HiveMatrix is now proactive by default: morning/evening briefs, an unprompted heartbeat, and weekly reviews; overdue goals surface in the brief; and recurring accountability rituals no longer silently die. Plus the iPad 'reconnecting' indicator is fixed.

## v0.1.195 — 2026-07-12

Voice calendar commands now parse dates correctly too (matching the chat-side fix): 'set an event July 19 at 3pm' lands on the right day and time.

## v0.1.194 — 2026-07-12

New Goals surface: track long-horizon goals (Solo Founder, fitness, Italian, Bible) with per-cadence check-ins and a 'due today' review — from the 🎯 Goals panel or in chat. Plus a calendar date-parsing fix so 'July 19 at 3 PM' lands on the right day and time.

## v0.1.193 — 2026-07-12

Drop a YouTube link into chat (digest_url) and get a rich HTML summary saved to your brain: clickable video link, thumbnail, a detailed transcript-based summary, and a 'how this applies to me' section tied to HiveMatrix and your Solo Founder goals.

## v0.1.192 — 2026-07-12

Observability redesigned: the full dashboard now takes over the center like New Task, tokens-by-model shows side-by-side bars so you can see which model you use most, and the scorecard is per-model (Opus/Sonnet/Haiku/Codex) with first-pass rate and cost per task.

## v0.1.191 — 2026-07-12

New Tools panel shows every capability the assistant has and what backs it; curated skills are now first-class tools; reminders read/create moved to the reliable EventKit helper (needs a one-time Reminders permission grant).

## v0.1.190 — 2026-07-12

Chat now reads your goals/plans (brain_read), unified voice+chat thread with task-completion posted back, dictation mic auto-sends, calendar access fixed (helper rebuilt), Talk button retired, qwen removed.

## v0.1.189 — 2026-07-12

Chat backlog: observability by-model graphs + Flash usage now tracked, chat honors the Autonomy dial, microphone fixed with a dictation mic above Send, MCP servers and Canopy now visible in setup.

## v0.1.188 — 2026-07-12

Learning pipeline hardened: skills with embedded code no longer get truncated during authoring, and the assistant prefers learning a quick script over driving the GUI for computable tasks.

## v0.1.187 — 2026-07-12

Learning resilience: a momentary model-call failure no longer cancels skill learning — HiveMatrix retries and finishes the job.

## v0.1.186 — 2026-07-12

Smarter learning: when a freshly-learned skill fails its own tests, HiveMatrix now retries once with the exact failure in hand, tests are written to pass on any machine, and failure details are kept for the next attempt.

## v0.1.185 — 2026-07-12

Honesty gate: the assistant can no longer fake a tool call and invent results — fabricated replies are discarded and it offers to learn a real skill instead; tool failures now trigger skill learning rather than asking you to do it by hand.

## v0.1.184 — 2026-07-12

Voice never dead-ends: when a tool fails, HiveMatrix now learns a new skill for the task instead of asking you to do it by hand; permission blocks get spoken remediation.

## v0.1.183 — 2026-07-12

Calendar first-run polish: while macOS's calendar-permission prompt is pending, HiveMatrix now says exactly how to grant access instead of a generic failure.

## v0.1.182 — 2026-07-12

Self-learning: calendar reads via EventKit (no more app-launch dead-end), skill_run lets voice/chat execute learned skills in a sandbox, learn_skill acquires+verifies new skills live on capability misses, 'update HiveMatrix to X' routes to the coding pipeline, background gap→skill acquisition under autonomous mode, morning brief reports what it learned.

## v0.1.181 — 2026-07-12

Cloudflare pairing QR: fix the display overflow (it was overlapping the security note and corrupting the scannable quiet zone) and make the dense QR scannable — constrain the SVG to its box, enlarge it 188→240px, and render at error-correction level L for bigger modules.

## v0.1.180 — 2026-07-11

Flash chat: remove the thumbs-down button, mark the assistant with the cyclone sigil; refresh the Cloudflare card copy to point at the Scan-on-iPhone pairing QR.

## v0.1.179 — 2026-07-11

Polish + Browser Lane fix: Observability hides retired local models (Claude-only) with by-model tiers; single live header indicator (dropped cloud-ok pill); provider On/Off toggles replaced by install/sign-in status (enablement = CLI detected); new Cloudflare pairing QR endpoint + card; Flash --resume session continuity with live streaming; and flash chat now disables the CLI's built-in tools so web reads route through Browser Lane instead of dead-ending on WebFetch.

## v0.1.178 — 2026-07-11

Fix Flash chat crash on any multi-turn conversation: the prompt is now piped via stdin instead of an argv value, so a prompt beginning with the '--- Prior conversation ---' transcript block is no longer mis-parsed by the claude CLI as an unknown option.

## v0.1.177 — 2026-07-11

Post-cutover cleanup: purge all remaining local/Qwen/Rapid-MLX UI from settings; Observability now breaks down by Claude model (Opus/Sonnet/Haiku/Codex) + 1h chart fix; Mail Lane TCC probe + auto retry so approval actually works; New Task no longer forces a Project (operations tasks run from home); retire Terminal Lane entirely (moved to Canopy); default model simplified to Opus/Sonnet (default Sonnet).

## v0.1.176 — 2026-07-11

Claude-native cutover: retire local Qwen entirely — every text role routes to Claude via the CLI (Opus=thinking, Sonnet=coding, Haiku=operational + chat). Flash chat on Haiku with lane tools as an MCP server; degeneration guards deleted; Local Model settings → Claude Models routing view; one-time config migration drops qwen/localEngine keys.

## v0.1.175 — 2026-07-11

Flash sampling: add top_k=20 (the honored anti-degeneration lever rapid-mlx was missing), expose full sampling param set in settings with a one-click Qwen-recommended preset

## v0.1.174 — 2026-07-11

Flash: catch repetition-with-drift degeneration (normalized unit-cycle guard); send repeat_penalty for rapid-mlx; prune drift-loop history

## v0.1.173 — 2026-07-11

Flash chat hardening: length-cap runaway guard for varied rambling, lower default max_tokens (2048→1024), both tunable in Settings > Local Model > Sampling; pruned poisoned chat history

## v0.1.172 — 2026-07-11

Fix Flash chat degeneration (word-loop repetition guard + repetition_penalty); expose sampling params (temperature/top_p/repetition_penalty/max_tokens) in Settings > Local Model

## v0.1.171 — 2026-07-11

Voice everywhere: PIM tools (contacts/calendar/reminders read + live reminder/event creation), voice approvals, tap-to-dial actions, loop-closer (voice tasks text their answer back), day-brief rituals + contextual call greeting, capability ratchet, Weaver audit

## v0.1.170 — 2026-07-10

Fix voice license fingerprint mismatch after hostname->hardware-UUID binding change; surface real Pipecat connect errors instead of generic NSError text on iOS

## v0.1.169 — 2026-07-10

Fix daemon launching with cwd=/ (WorkingDirectory missing from launchd plist), causing skill/feedback/directive tasks to get permanently stuck; also fix task-role vs auth-profile field confusion in skill/feedback task creation

## v0.1.168 — 2026-07-10

Fix Tailscale toggle always showing Off in Settings

## v0.1.167 — 2026-07-10

Developer ID release

## v0.1.166 — 2026-07-10

Developer ID release

## v0.1.165 — 2026-07-10

Developer ID release

## v0.1.164 — 2026-07-10

Developer ID release

## v0.1.163 — 2026-07-10

Developer ID release

## v0.1.162 — 2026-07-09

Developer ID release

## v0.1.161 — 2026-07-09

Developer ID release

## v0.1.160 — 2026-07-09

Developer ID release

## v0.1.159 — 2026-07-09

Chat rename, 7-day usage day-ticks, prompt-wizard task titles, task provenance pills

## v0.1.158 — 2026-07-09

Fix: expand '~' projectPath (Inbox project) before task creation, preventing an ENOENT on task spawn

## v0.1.157 — 2026-07-09

Add release-hivematrix skill wrapping canonical developer-id-release.sh

## v0.1.156 — 2026-07-07

Terminal Lane: command policy + audit log; local engine runtime repair; keychain/readiness hardening

## v0.1.155 — 2026-07-07

Fix voice/flash reply repetition loop; add iOS dark + tinted app-icon appearances

## v0.1.154 — 2026-07-07

The router now learns from your re-routes (change a task's model repeatedly for a kind of task and it adopts that as the default). Pipeline self-audit: the accountability layer inspects its own metrics daily and files regressions as feedback — the system watching itself.

## v0.1.153 — 2026-07-07

Internal simplification: 12 duplicated poll-loops (Message Lane, Mail Lane, Browser Lane readiness, and background loops) converged onto one shared scaffolding; complexity-budget convention documented for the coding agents. No user-facing behavior change.

## v0.1.152 — 2026-07-07

Escalation ladder now tries the other local model (on-device coding specialist) before spending a frontier token — works even offline. Success scoreboard added to the brief: measurable progress against goals (directive criteria proven, weekly task outcomes, first-pass rate). Deep Think now powers local directive planning.

## v0.1.151 — 2026-07-07

Deep Think in directive planning: when planning runs on the local model, the plan is produced with test-time compute (diverse rollouts + self-consistency on Qwen) for higher quality — free tokens, latency-tolerant.

## v0.1.150 — 2026-07-07

Fixes: duplicate local model removed from the New Task picker (deduped by family); console now auto-reloads after an in-place app update so removed UI (Flights) no longer lingers as a stale page.

## v0.1.149 — 2026-07-07

Green-on-white app icon (single identity, no light/dark toggle). Flights/Work Packages removed entirely — broad and multi-step prompts now self-plan via Superpowers (the frontier coding harness plans and executes its own subtasks). New Task Mode is Auto or Direct; Settings simplified.

## v0.1.148 — 2026-07-07

Pipeline hardening: ruff static-analysis verification gate + local repair-ladder; local-failure→frontier escalation package; route scorecard + advisory routing bandit; unified decidePolicy approval choke point; frontier-owns-code intake (broad prompts dispatch as one task, Work Packages opt-in); self-aware pipeline health in the heartbeat/brief.

## v0.1.147 — 2026-07-06

Use Qwen Rapid-MLX for local chat

## v0.1.146 — 2026-07-06

auto-deploy HiveMatrix

## v0.1.145 — 2026-07-06

Message Lane setup removal controls

## v0.1.144 — 2026-07-06

Message Lane self handles and voice email bridge

## v0.1.143 — 2026-07-06

Simplify voice/video: Kokoro-only TTS; remove the video factory / HeyGen pipeline entirely.

## v0.1.142 — 2026-07-05

Developer ID release

## v0.1.141 — 2026-07-05

Developer ID release

## v0.1.140 — 2026-07-05

Fix Tailscale pairing URL: advertise the MagicDNS HTTPS serve endpoint (https://<magicDNS>) instead of a dead loopback-bound http://<tailnet-ip>:port

## v0.1.139 — 2026-07-05

First hivematrix-core.json feed release on the Developer ID identity com.irvcassio.hivematrix.core; new-task box shows pickable command options; arms auto-update for the new identity

## v0.1.138 — 2026-07-05

Fix auto-update so new versions take effect: after install the bundled daemon restarts into the new version, and the daemon self-heals when updated from an older build

## v0.1.137 — 2026-07-05

Fix iOS Talk and Live voice replies

## v0.1.136 — 2026-07-04

Harden inbound pollers and Browser Lane reads: mail/message poll loops log failures instead of swallowing them, and the Browser Lane read client bounds its fetch with a timeout so a hung app fails the read instead of stalling the calling task

## v0.1.135 — 2026-07-04

Proactive-partner layer: heartbeat presence (pulse plus morning brief and evening recap), operator modeling and voice-writable goal ledger, backlog pattern detection, capability self-assessment, autonomy trust-ramp, deep-think reasoning on the local model, and voice deep-think/goals/memory/heartbeat commands; hardened by an adversarial review pass (enforced heartbeat tool gating, continuous learning, contestable trust, atomic config writes)

## v0.1.134 — 2026-07-04

loop-guard smoke verification prevents false-complete coding tasks

## v0.1.133 — 2026-07-04

DeepSeek agentic parity: per-request thinking off-switch (thinking:disabled) reachable over HTTP with an auto skip-in-the-middle/think-at-the-ends heuristic across agent turns, plus an opt-in native ds4-agent as a 4th DeepSeek coding harness (KV-cache /save+/switch sessions), off by default and gated to no-lane coding tasks so Qwen/Codex/Claude paths are untouched

## v0.1.132 — 2026-07-04

Standardize local models after the tools/model-bench bake-off: DeepSeek V4 Flash q2-q4 primary (128GB machines) with Qwen3.6-35B-A3B via Rapid-MLX as the lower-memory option (MLX tool calling enabled), fix Mixed-mode routing that ignored the configured local model and pointed Claude sessions at the local endpoint, mandatory code-verification gate on every coding agent, on-demand Qwen3-Embedding-0.6B via Ollama for brain search, and a RAM-aware install-local-model.sh for new machines

## v0.1.131 — 2026-07-04

Maintenance: de-duplicate the 0.1.130 changelog entry that concurrent releases left doubled

## v0.1.130 — 2026-07-04

Fix mobile pairing: the QR now shows a clear reason instead of a blank box when it can't render, Settings reflects saved Cloudflare Access credentials, and saving just the secret no longer wipes the client id; add a local license-issue script (counterpart to license-keygen) and harden messagebee onboarding tests against an installed Pro license

## v0.1.129 — 2026-07-04

Fix slow local DeepSeek tasks: forward each task's thinking mode to Dwarf Star as reasoning_effort so lighter work decodes faster, give goal decomposition a real 60s timeout (12s default aborted every thinking-mode split and silently fell back), and quadruple the ds4-server KV disk cache budget to stop per-turn prefill re-thrashing

## v0.1.128 — 2026-07-04

Optimize DeepSeek goal decomposition: goal-aware flight intake split, offline local-model support, reasoning token budget

## v0.1.127 — 2026-07-03

Browser Lane and Terminal Lane apps now host the agent read/run backends (127.0.0.1:4011 and :4012) so DeepSeek tasks complete and are watchable in-app; local model health config-matching and test-isolation fix; voice routes to the configured Dwarf Star DeepSeek model

## v0.1.126 — 2026-07-03

Make Codex optional and hide unavailable OpenClaw

## v0.1.125 — 2026-07-03

Fix settings and DeepSeek local model UI

## v0.1.124 — 2026-07-03

cloud-first local model setup

## v0.1.123 — 2026-07-03

lock deep link dependencies

## v0.1.122 — 2026-07-03

ship phase gate ledger

## v0.1.121 — 2026-07-02

Phase 4 outcome packs and companion surfaces

## v0.1.120 — 2026-07-02

auto-deploy HiveMatrix next level spec

## v0.1.119 — 2026-07-02

auto-update rebuild

## v0.1.118 — 2026-07-02

improve Flight autonomy and operator feedback

## v0.1.117 — 2026-07-01

7-day usage bar green-red pacing

## v0.1.116 — 2026-07-01

ship OpenClaw center pane

## v0.1.115 — 2026-07-01

refresh desktop auto-update release

## v0.1.114 — 2026-07-01

Fix Vale voice bridge and Flight duplication

## v0.1.113 — 2026-07-01

ship model routing, voice reminders, usage pacing, and console polish

## v0.1.112 — 2026-06-30

ship OpenClaw chat dock and command project routing

## v0.1.111 — 2026-06-30

complete Flight lanes and guard work-package auto-land

## v0.1.110 — 2026-06-29

auto-deploy HiveMatrix

## v0.1.109 — 2026-06-29

lane-off guards for Mail and Message Lane

## v0.1.108 — 2026-06-29

auto-update console fixes

## v0.1.107 — 2026-06-29

flight child autonomy + one-click decisions

## v0.1.106 — 2026-06-29

about version metadata refresh

## v0.1.105 — 2026-06-29

disabled lane passive probe fix

## v0.1.104 — 2026-06-28

Flight review reply reconciliation

## v0.1.103 — 2026-06-28

Flight loop profiles and release preflight

## v0.1.102 — 2026-06-28

Flight reliability and Goal Flights

## v0.1.101 — 2026-06-28

UI polish and Flight queue fixes

## v0.1.100 — 2026-06-28

_Maintenance release._

## v0.1.99 — 2026-06-27

_Maintenance release._

## v0.1.98 — 2026-06-27

Queued-task restart and project picker fixes

## v0.1.97 — 2026-06-27

Main-screen Flights orchestration UX

## v0.1.96 — 2026-06-27

_Maintenance release._

## v0.1.95 — 2026-06-27

_Maintenance release._

## v0.1.94 — 2026-06-27

_Maintenance release._

## v0.1.93 — 2026-06-27

Voice weather inline answers + console UI polish

## v0.1.92 — 2026-06-26

Post-autoupdate Lane app update handling

## v0.1.91 — 2026-06-26

_Maintenance release._

## v0.1.90 — 2026-06-26

Operator-path hardening: Browser Lane Add Site, lane app Edit menus, video-approval guard, release smoke

## v0.1.89 — 2026-06-26

lane app artifact delivery

## v0.1.88 — 2026-06-26

system readiness repair actions

## v0.1.87 — 2026-06-26

Browser Lane Google SSO, Terminal Lane, voice tools, and console UI updates

## v0.1.86 — 2026-06-26

Browser Lane readiness, workflow inbox, and Terminal Lane cleanup

## v0.1.84 — 2026-06-25

Bee-to-Lane rename: lane-native tools, services, config, central protocol, and refreshed guides

## v0.1.83 — 2026-06-24

video: Approve renders via HeyGen Video Agent by default (slides + annotations + B-roll); failed renders are re-approvable; accuracy guard against invented stats

## v0.1.82 — 2026-06-24

video: render failures (e.g. HeyGen out of credit) now surface on the review task instead of silently closing — retry or cancel

## v0.1.81 — 2026-06-24

video: editing a script now saves & stays in review (approve renders separately) + clear review controls; 'create an AI-news video' routes straight to draft/review

## v0.1.80 — 2026-06-24

browsable Release notes in Settings (changelog of every version + summary), auto-updated each release

## v0.1.79 — 2026-06-24

console: edit drafted scripts in place (Edit the draft button), persistent reply-box resize, copy from Result

## v0.1.78 — 2026-06-24

writer-role model selection (frontier or lock-free) + retire weekly-news as a feature (video factory runs via a directive)

## v0.1.77 — 2026-06-24

video: AI-news script now written by the local model (was a canned template); full script shown at the review checkpoint; agents must review-before-render

## v0.1.76 — 2026-06-24

voice: escalated-task results now return to the open Talk session

## v0.1.75 — 2026-06-23

fix: voice message/text/email requests now escalate to a real task and get sent

## v0.1.74 — 2026-06-23

consistent live Kokoro voice across Talk + iMessage (warm /synth endpoint); cloned voice reserved for produced narration

## v0.1.73 — 2026-06-23

voice escalation + video review hardening + iOS demo fixes

## v0.1.72 — 2026-06-23

_Maintenance release._

## v0.1.71 — 2026-06-23

_Maintenance release._

## v0.1.70 — 2026-06-23

_Maintenance release._

## v0.1.69 — 2026-06-23

_Maintenance release._

## v0.1.68 — 2026-06-23

_Maintenance release._

## v0.1.67 — 2026-06-23

_Maintenance release._

## v0.1.66 — 2026-06-23

_Maintenance release._

## v0.1.65 — 2026-06-23

_Maintenance release._

## v0.1.63 — 2026-06-22

voice command layer + console UI overhaul + iOS voice redesign

## v0.1.62 — 2026-06-22

_Maintenance release._

## v0.1.61 — 2026-06-22

_Maintenance release._

## v0.1.60 — 2026-06-22

_Maintenance release._

## v0.1.59 — 2026-06-22

_Maintenance release._

## v0.1.58 — 2026-06-22

Voice: ask Voice Lane to remind you or add a task and it lands in HiveMatrix; unanswered questions escalate too

## v0.1.57 — 2026-06-21

Voice: ask Voice Lane to read an email, list senders, or summarize your inbox — not just count

## v0.1.56 — 2026-06-20

Voice: consistent ~1s spoken turns (email-tool gate) + Kokoro works out-of-the-box for new installs (espeak via pip)

## v0.1.55 — 2026-06-20

Voice: kill spurious email-tool stalls — every spoken turn is now consistently fast (~1s)

## v0.1.54 — 2026-06-20

Kokoro fast TTS for interactive Talk — ~1s voice turns (was several seconds on the cloned voice)

## v0.1.53 — 2026-06-20

Persistent push-to-talk voice worker — STT+TTS stay warm across turns (no per-turn model reload)

## v0.1.52 — 2026-06-20

grouped new-task model selector

## v0.1.51 — 2026-06-20

two-tier Rapid-MLX routing, coding-tier task selection, reasoning status

## v0.1.50 — 2026-06-20

Rapid-MLX local-engine + live status in Settings

## v0.1.49 — 2026-06-20

voice TTS cache+warmup, Mail Lane voice tool, selectable app icon

## v0.1.48 — 2026-06-19

voice TURN, Matrix theme, hex-flower icon, opacity slider

## v0.1.47 — 2026-06-19

role-model-overrides

## v0.1.46 — 2026-06-19

command layout hotfix

## v0.1.45 — 2026-06-19

attachment provider parity

## v0.1.44 — 2026-06-19

console input cleanup

## v0.1.43 — 2026-06-17

_Maintenance release._

## v0.1.42 — 2026-06-17

_Maintenance release._

## v0.1.41 — 2026-06-17

_Maintenance release._

## v0.1.40 — 2026-06-17

_Maintenance release._

## v0.1.39 — 2026-06-16

command launcher provenance UI

## v0.1.38 — 2026-06-16

feat: render result tables and Mermaid

## v0.1.37 — 2026-06-16

fix: daemon native runtime ABI

## v0.1.36 — 2026-06-16

fix: command launcher owns project context

## v0.1.35 — 2026-06-16

fix: command launches use selected home project path

## v0.1.34 — 2026-06-16

feat: /uploads endpoint (iOS attachments transfer real bytes to host); steer any in-progress task, not just Codex

## v0.1.33 — 2026-06-15

fix: Mail Lane never auto-replies a Gmail/MCP auth dead-end; task tells agent to attach files via Apple Mail send path, not Gmail

## v0.1.32 — 2026-06-15

fix: strip NUL bytes from spawn argv so AGENTS.md/CLAUDE.md with stray nulls can't crash task launch

## v0.1.31 — 2026-06-15

local commands & skills catalog

## v0.1.30 — 2026-06-15

_Maintenance release._

## v0.1.29 — 2026-06-15

_Maintenance release._

## v0.1.28 — 2026-06-15

_Maintenance release._

## v0.1.27 — 2026-06-15

_Maintenance release._

## v0.1.26 — 2026-06-14

_Maintenance release._

## v0.1.25 — 2026-06-14

_Maintenance release._

## v0.1.24 — 2026-06-14

_Maintenance release._

## v0.1.23 — 2026-06-14

_Maintenance release._

## v0.1.22 — 2026-06-14

_Maintenance release._

## v0.1.21 — 2026-06-14

_Maintenance release._

## v0.1.20 — 2026-06-14

_Maintenance release._

## v0.1.19 — 2026-06-14

_Maintenance release._

## v0.1.18 — 2026-06-14

collapsible console + ops script skills

## v0.1.17 — 2026-06-13

Claude auth login

## v0.1.16 — 2026-06-13

interaction fixes

## v0.1.15 — 2026-06-13

usage refresh

## v0.1.14 — 2026-06-13

focus and Mail Lane fixes

## v0.1.13 — 2026-06-13

updater fixes
