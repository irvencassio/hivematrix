import type { MailbeeStatus } from "@/lib/mailbee/status";
import type { MessagebeeStatus } from "@/lib/messagebee/status";
import type { ProvisionPlan, ProvisionStatus } from "@/lib/models/provision";
import type { PersonaStatus } from "@/lib/onboarding/birth-ritual";
import type { OnboardingStatus, OnboardingStep } from "@/lib/onboarding/onboarding";

export type SetupItemState =
  | "unknown"
  | "not_requested"
  | "opened"
  | "needs_action"
  | "granted"
  | "configured"
  | "ready";

export interface SetupItem {
  id: string;
  title: string;
  state: SetupItemState;
  detail: string;
  action?: string;
}

export interface FirstRunSetupStatus {
  permissions: SetupItem[];
  models: SetupItem[];
  memory: SetupItem[];
  optional: SetupItem[];
  requiredReady: boolean;
}

export interface DesktopSetupSnapshot {
  helperBuilt?: boolean;
  helperReachable?: boolean;
  permissions?: {
    accessibility: boolean;
    screenRecording: boolean;
  } | null;
}

export interface LocalModelSetupSnapshot {
  configured?: boolean;
  detail?: string;
  plan?: ProvisionPlan | null;
  status?: ProvisionStatus | null;
}

export type PersonaSetupSnapshot = PersonaStatus | {
  exists?: boolean;
  detail?: string;
  name?: string;
  emoji?: string;
  avatarPath?: string;
};

export interface FirstRunSetupStatusInput {
  onboarding?: OnboardingStatus | null;
  messagebee?: MessagebeeStatus | null;
  fullDiskAccessProbe?: MessagebeeStatus | null;
  mailbee?: MailbeeStatus | null;
  mailAutomationProbe?: MailbeeStatus | null;
  desktop?: DesktopSetupSnapshot | null;
  localModel?: LocalModelSetupSnapshot | null;
  persona?: PersonaSetupSnapshot | null;
  microphoneOpened?: boolean;
}

function onboardingStep(onboarding: OnboardingStatus | null | undefined, id: string): OnboardingStep | null {
  return onboarding?.steps.find((s) => s.id === id) ?? null;
}

function optionalStateFromStep(step: OnboardingStep | null): SetupItemState {
  if (!step) return "unknown";
  if (step.state === "done") return "ready";
  return /disabled|not enabled/i.test(step.detail) ? "not_requested" : "needs_action";
}

function buildFullDiskAccess(input: FirstRunSetupStatusInput): SetupItem {
  const probe = input.fullDiskAccessProbe ?? input.messagebee ?? null;
  if (!probe) {
    return {
      id: "fullDiskAccess",
      title: "Full Disk Access",
      state: "not_requested",
      detail: "Messages database access has not been checked yet.",
      action: "check_full_disk_access",
    };
  }

  if (probe.chatDbReadable) {
    return {
      id: "fullDiskAccess",
      title: "Full Disk Access",
      state: "granted",
      detail: probe.chatDbDetail || "Messages database readable.",
    };
  }

  if (probe.chatDbProbeSkipped) {
    return {
      id: "fullDiskAccess",
      title: "Full Disk Access",
      state: "not_requested",
      detail: "Messages database access has not been checked yet.",
      action: "check_full_disk_access",
    };
  }

  return {
    id: "fullDiskAccess",
    title: "Full Disk Access",
    state: "needs_action",
    detail: probe.chatDbDetail || "Messages database is not readable.",
    action: "open_full_disk_access_settings",
  };
}

function buildDesktopControl(input: FirstRunSetupStatusInput): SetupItem {
  const desktop = input.desktop ?? null;
  if (!desktop) {
    return {
      id: "desktopControl",
      title: "Desktop Control",
      state: "unknown",
      detail: "Desktop helper permission status unknown.",
      action: "request_desktop_permissions",
    };
  }

  const perms = desktop.permissions ?? null;
  const helper =
    desktop.helperReachable === true ? "helper reachable"
      : desktop.helperReachable === false ? "helper not reachable"
        : desktop.helperBuilt === true ? "helper built; reachability unknown"
          : desktop.helperBuilt === false ? "helper not built"
            : "helper status unknown";

  if (!perms) {
    return {
      id: "desktopControl",
      title: "Desktop Control",
      state: desktop.helperBuilt === false ? "needs_action" : "unknown",
      detail: `${helper}; permissions unknown`,
      action: desktop.helperBuilt === false ? "install_desktop_helper" : "request_desktop_permissions",
    };
  }

  const detail = `${helper}; accessibility=${perms.accessibility} screenRecording=${perms.screenRecording}`;
  const granted = perms.accessibility && perms.screenRecording;
  return {
    id: "desktopControl",
    title: "Desktop Control",
    state: granted ? "granted" : "needs_action",
    detail,
    action: granted ? undefined : "request_desktop_permissions",
  };
}

function buildMailAutomation(input: FirstRunSetupStatusInput): SetupItem {
  const probe = input.mailAutomationProbe ?? input.mailbee ?? null;
  if (!probe || probe.mailProbeSkipped) {
    return {
      id: "mailAutomation",
      title: "Mail Automation",
      state: "not_requested",
      detail: "Mail.app automation access has not been checked yet.",
      action: "check_mail_automation",
    };
  }

  return {
    id: "mailAutomation",
    title: "Mail Automation",
    state: probe.mailControllable ? "granted" : "needs_action",
    detail: probe.mailControllable
      ? "Mail.app automation is available."
      : "Mail.app automation permission is needed.",
    action: probe.mailControllable ? undefined : "check_mail_automation",
  };
}

function buildMicrophone(opened: boolean | undefined): SetupItem {
  return {
    id: "microphone",
    title: "Microphone",
    state: opened ? "opened" : "not_requested",
    detail: opened
      ? "Microphone panel opened; macOS will request access during the first Talk Mode use."
      : "Microphone access has not been requested yet.",
    action: "open_microphone_permission",
  };
}

function buildLocalModel(input: FirstRunSetupStatusInput): SetupItem {
  const snapshot = input.localModel ?? null;
  const step = onboardingStep(input.onboarding, "local-model");
  const status = snapshot?.status ?? null;
  const plan = snapshot?.plan ?? status?.plan ?? null;

  if (status?.phase === "running") {
    return {
      id: "localModel",
      title: "Local model provisioning",
      state: "configured",
      detail: "Local model provisioning is running.",
    };
  }

  if (status?.phase === "done") {
    return {
      id: "localModel",
      title: "Local model provisioning",
      state: "ready",
      detail: "Local model provisioning completed.",
    };
  }

  if (status?.phase === "error") {
    return {
      id: "localModel",
      title: "Local model provisioning",
      state: "needs_action",
      detail: status.error ? `Local model provisioning failed: ${status.error}` : "Local model provisioning failed.",
      action: "provision_local_model",
    };
  }

  if (snapshot?.configured === true || step?.state === "done") {
    return {
      id: "localModel",
      title: "Local model provisioning",
      state: "configured",
      detail: snapshot?.detail ?? step?.detail ?? "Local model configured.",
    };
  }

  if (plan) {
    const tiers = plan.recommendedTiers.length ? plan.recommendedTiers.join(" + ") : "cloud-only";
    return {
      id: "localModel",
      title: "Local model provisioning",
      state: plan.localCapable ? "needs_action" : "configured",
      detail: plan.localCapable
        ? `Provision Rapid-MLX for this Mac: ${tiers}.`
        : `Local model not required: ${plan.reason ?? "this Mac is cloud-only"}.`,
      action: plan.localCapable ? "provision_local_model" : undefined,
    };
  }

  return {
    id: "localModel",
    title: "Local model provisioning",
    state: step ? "needs_action" : "unknown",
    detail: step?.detail ?? "Local model provisioning status unknown.",
    action: "provision_local_model",
  };
}

function buildBrain(input: FirstRunSetupStatusInput): SetupItem {
  const step = onboardingStep(input.onboarding, "brain");
  if (!step) {
    return {
      id: "brain",
      title: "Brain memory plane",
      state: "unknown",
      detail: "Brain memory status unknown.",
    };
  }

  return {
    id: "brain",
    title: step.title,
    state: step.state === "done" ? "configured" : "needs_action",
    detail: step.detail,
    action: step.state === "done" ? undefined : "configure_brain",
  };
}

function personaExists(persona: PersonaSetupSnapshot): boolean {
  if ("state" in persona) return persona.state === "existing";
  return persona.exists === true;
}

function buildPersona(input: FirstRunSetupStatusInput): SetupItem {
  const persona = input.persona ?? null;
  const step = onboardingStep(input.onboarding, "persona");

  if (persona) {
    const exists = personaExists(persona);
    const detail = "detail" in persona && persona.detail
      ? persona.detail
      : exists
        ? `Persona established${"name" in persona && persona.name ? `: ${persona.name}` : ""}.`
        : "Persona not yet created - run the birth ritual.";
    return {
      id: "persona",
      title: "Persona",
      state: exists ? "ready" : "needs_action",
      detail,
      action: exists ? undefined : "run_birth_ritual",
    };
  }

  if (step) {
    return {
      id: "persona",
      title: "Persona",
      state: step.state === "done" ? "ready" : "needs_action",
      detail: step.detail,
      action: step.state === "done" ? undefined : "run_birth_ritual",
    };
  }

  return {
    id: "persona",
    title: "Persona",
    state: "unknown",
    detail: "Persona status unknown.",
    action: "run_birth_ritual",
  };
}

function buildMessageLane(input: FirstRunSetupStatusInput): SetupItem {
  const status = input.messagebee ?? input.fullDiskAccessProbe ?? null;
  const step = onboardingStep(input.onboarding, "messagebee");
  if (status) {
    const ready = status.enabled && status.chatDbReadable;
    return {
      id: "messageLane",
      title: "Message Lane",
      state: ready ? "ready" : status.enabled ? "needs_action" : "not_requested",
      detail: status.enabled
        ? status.chatDbDetail
        : status.chatDbReadable
          ? "Messages database readable; Message Lane disabled."
          : "Message Lane disabled.",
      action: ready ? undefined : "configure_message_lane",
    };
  }

  return {
    id: "messageLane",
    title: step?.title ?? "Message Lane",
    state: optionalStateFromStep(step),
    detail: step?.detail ?? "Message Lane status unknown.",
    action: step?.state === "done" ? undefined : "configure_message_lane",
  };
}

function buildMailLane(input: FirstRunSetupStatusInput): SetupItem {
  const status = input.mailbee ?? input.mailAutomationProbe ?? null;
  const step = onboardingStep(input.onboarding, "mailbee");
  if (status) {
    const ready = status.enabled && status.mailControllable;
    return {
      id: "mailLane",
      title: "Mail Lane",
      state: ready ? "ready" : status.enabled ? "needs_action" : "not_requested",
      detail: status.enabled
        ? status.mailControllable
          ? "Mail Lane enabled; Mail.app automation granted."
          : "Mail Lane enabled; Mail.app automation permission needed."
        : "Mail Lane disabled.",
      action: ready ? undefined : "configure_mail_lane",
    };
  }

  return {
    id: "mailLane",
    title: step?.title ?? "Mail Lane",
    state: optionalStateFromStep(step),
    detail: step?.detail ?? "Mail Lane status unknown.",
    action: step?.state === "done" ? undefined : "configure_mail_lane",
  };
}

function buildDesktopLane(input: FirstRunSetupStatusInput): SetupItem {
  const step = onboardingStep(input.onboarding, "desktopbee");
  const desktop = input.desktop ?? null;
  if (desktop?.permissions) {
    const ready = desktop.helperBuilt === true && desktop.helperReachable === true &&
      desktop.permissions.accessibility && desktop.permissions.screenRecording;
    return {
      id: "desktopLane",
      title: "Desktop Lane",
      state: ready ? "ready" : "needs_action",
      detail: `helperBuilt=${desktop.helperBuilt === true} helperReachable=${desktop.helperReachable === true} accessibility=${desktop.permissions.accessibility} screenRecording=${desktop.permissions.screenRecording}`,
      action: ready ? undefined : "configure_desktop_lane",
    };
  }

  return {
    id: "desktopLane",
    title: step?.title ?? "Desktop Lane",
    state: optionalStateFromStep(step),
    detail: step?.detail ?? "Desktop Lane status unknown.",
    action: step?.state === "done" ? undefined : "configure_desktop_lane",
  };
}

export function buildFirstRunSetupStatus(input: FirstRunSetupStatusInput = {}): FirstRunSetupStatus {
  return {
    permissions: [
      buildFullDiskAccess(input),
      buildDesktopControl(input),
      buildMailAutomation(input),
      buildMicrophone(input.microphoneOpened),
    ],
    models: [buildLocalModel(input)],
    memory: [buildBrain(input), buildPersona(input)],
    optional: [buildMessageLane(input), buildMailLane(input), buildDesktopLane(input)],
    requiredReady: input.onboarding?.requiredComplete === true,
  };
}
