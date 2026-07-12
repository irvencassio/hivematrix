/**
 * Unified push fan-out — one alert, both native push transports. APNs
 * (ios/watchos) and FCM (android/wearos) each read their own registered-device
 * list, so platform routing is implicit: sendPush() just calls both and lets
 * whichever transport has devices deliver. Callers (heartbeat, morning
 * briefing, voice loop-closer) no longer need to know which platform their
 * operator is on.
 */

import { sendApnsPush, type ApnsPushResult } from "@/lib/notify/apns";
import { sendFcmPush, type FcmPushResult } from "@/lib/notify/fcm";

export interface PushOptions {
  title: string;
  body: string;
  /** Custom data merged into each platform payload (read by the app on tap). */
  data?: Record<string, unknown>;
}

export interface PushResult {
  /** True if at least one transport (APNs or FCM) is configured. */
  configured: boolean;
  /** Total successful deliveries across both transports. */
  sent: number;
  apns: ApnsPushResult;
  fcm: FcmPushResult;
}

/**
 * Send a push to every registered device across both transports. Each
 * transport no-ops (configured:false, sent:0) on its own when it isn't set up
 * or has no registered devices, so this is safe to call unconditionally.
 */
export async function sendPush(opts: PushOptions): Promise<PushResult> {
  const [apns, fcm] = await Promise.all([sendApnsPush(opts), sendFcmPush(opts)]);
  return {
    configured: apns.configured || fcm.configured,
    sent: apns.sent + fcm.sent,
    apns,
    fcm,
  };
}
