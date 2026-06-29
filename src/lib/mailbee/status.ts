import { canControlMail as defaultCanControlMail } from "./applemail";
import { isChannelEnabled, listIdentities, trustedDomains, triageAll, type MailIdentity } from "./store";

type CanControlMail = (timeoutMs?: number, opts?: { allowLaunch?: boolean }) => Promise<boolean>;

export interface MailbeeStatus {
  enabled: boolean;
  mailControllable: boolean;
  mailProbeSkipped: boolean;
  mailProbeReason?: "channel_disabled";
  identities: MailIdentity[];
  trustedDomains: string[];
  triageAll: boolean;
}

let canControlMailForStatus: CanControlMail = defaultCanControlMail;

export function _setMailbeeStatusDepsForTests(deps: { canControlMail?: CanControlMail } | null): void {
  canControlMailForStatus = deps?.canControlMail ?? defaultCanControlMail;
}

export async function getMailbeeStatus(opts: { probe?: boolean } = {}): Promise<MailbeeStatus> {
  const enabled = isChannelEnabled();
  const shouldProbe = opts.probe === true || enabled;
  const mailControllable = shouldProbe ? await canControlMailForStatus(undefined, { allowLaunch: opts.probe === true }) : false;
  return {
    enabled,
    mailControllable,
    mailProbeSkipped: !shouldProbe,
    mailProbeReason: shouldProbe ? undefined : "channel_disabled",
    identities: listIdentities(),
    trustedDomains: trustedDomains(),
    triageAll: triageAll(),
  };
}
