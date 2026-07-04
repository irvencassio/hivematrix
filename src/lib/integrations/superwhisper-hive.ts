// Superwhisper integration stub — deferred from HiveMatrix v1.
 
export function notifySuperwhisperPermissionRequest(_taskId: unknown, _params?: unknown): void { /* deferred */ }
 
export function notifySuperwhisperSession(_params: unknown): void { /* deferred */ }
 
export function notifySuperwhisperStreamEvent(_session: unknown, _event: unknown): void { /* deferred */ }
 
export function notifySuperwhisperTaskStart(_params: unknown): void { /* deferred */ }
 
export function notifySuperwhisperTaskStop(_params: unknown): void { /* deferred */ }
 
export function detectSuperwhisperApproval(_params: unknown): boolean { return false; }
 
export function handleSuperwhisperInboundText(_params: unknown): null { return null; }
export type SuperwhisperApprovalResult = null;
export type SuperwhisperHiveConfig = Record<string, never>;
