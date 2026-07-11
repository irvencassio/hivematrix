import { probeAppleMail as defaultProbeAppleMail, type MailProbeKind } from "./applemail";
import { isChannelEnabled, listIdentities, trustedDomains, triageAll, type MailIdentity } from "./store";

type ProbeAppleMail = (timeoutMs?: number, opts?: { allowLaunch?: boolean }) => Promise<{ ok: boolean; kind: MailProbeKind; detail: string }>;

export interface MailbeeStatus {
  enabled: boolean;
  mailControllable: boolean;
  mailProbeSkipped: boolean;
  mailProbeReason?: "channel_disabled";
  // Real reason behind mailControllable=false (granted/not_authorized/not_running/
  // timeout/error) so the setup UI can show something better than a generic
  // "approval needed" — see applemail.ts's probeAppleMail.
  mailProbeKind?: MailProbeKind;
  mailProbeDetail?: string;
  identities: MailIdentity[];
  trustedDomains: string[];
  triageAll: boolean;
}

let probeAppleMailForStatus: ProbeAppleMail = defaultProbeAppleMail;

// Back-compat injection point: existing tests / call sites configure this
// with a plain boolean-returning canControlMail-shaped function. Normalize it
// to the {ok,kind,detail} shape probeAppleMail-based callers expect.
type CanControlMailLike = ((timeoutMs?: number, opts?: { allowLaunch?: boolean }) => Promise<boolean>) | ProbeAppleMail;

function normalizeProbeDep(fn: CanControlMailLike): ProbeAppleMail {
  return async (timeoutMs, opts) => {
    const result = await fn(timeoutMs, opts);
    if (typeof result === "boolean") {
      return result
        ? { ok: true, kind: "granted", detail: "HiveMatrix can control Apple Mail." }
        : { ok: false, kind: "error", detail: "Mail.app not controllable." };
    }
    return result;
  };
}

export function _setMailbeeStatusDepsForTests(deps: { canControlMail?: CanControlMailLike } | null): void {
  probeAppleMailForStatus = deps?.canControlMail ? normalizeProbeDep(deps.canControlMail) : defaultProbeAppleMail;
}

export async function getMailbeeStatus(opts: { probe?: boolean } = {}): Promise<MailbeeStatus> {
  const enabled = isChannelEnabled();
  const shouldProbe = opts.probe === true || enabled;
  const probeResult = shouldProbe ? await probeAppleMailForStatus(undefined, { allowLaunch: opts.probe === true }) : null;
  return {
    enabled,
    mailControllable: probeResult?.ok === true,
    mailProbeSkipped: !shouldProbe,
    mailProbeReason: shouldProbe ? undefined : "channel_disabled",
    mailProbeKind: probeResult?.kind,
    mailProbeDetail: probeResult?.detail,
    identities: listIdentities(),
    trustedDomains: trustedDomains(),
    triageAll: triageAll(),
  };
}
