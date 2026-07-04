import { probeChatDbAccess as defaultProbeChatDbAccess, type ChatDbAccessProbe } from "./imessage";
import { getSelfHandles, isChannelEnabled, listIdentities, type MessageIdentity } from "./store";

type ProbeChatDbAccess = () => ChatDbAccessProbe;

export interface MessagebeeStatus {
  enabled: boolean;
  chatDbReadable: boolean;
  chatDbDetail: string;
  chatDbProbeSkipped: boolean;
  chatDbProbeReason?: "channel_disabled";
  identities: MessageIdentity[];
  selfHandles: string[];
}

let probeChatDbAccessForStatus: ProbeChatDbAccess = defaultProbeChatDbAccess;

export function _setMessagebeeStatusDepsForTests(deps: { probeChatDbAccess?: ProbeChatDbAccess } | null): void {
  probeChatDbAccessForStatus = deps?.probeChatDbAccess ?? defaultProbeChatDbAccess;
}

export function getMessagebeeStatus(opts: { probe?: boolean } = {}): MessagebeeStatus {
  const enabled = isChannelEnabled();
  const shouldProbe = opts.probe === true || enabled;
  if (!shouldProbe) {
    return {
      enabled,
      chatDbReadable: false,
      chatDbDetail: "Message Lane disabled",
      chatDbProbeSkipped: true,
      chatDbProbeReason: "channel_disabled",
      identities: listIdentities(),
      selfHandles: getSelfHandles(),
    };
  }

  const probe = probeChatDbAccessForStatus();
  return {
    enabled,
    chatDbReadable: probe.ok,
    chatDbDetail: probe.detail,
    chatDbProbeSkipped: false,
    identities: listIdentities(),
    selfHandles: getSelfHandles(),
  };
}
