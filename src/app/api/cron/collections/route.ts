import { commerce, failure, json } from "@/lib/commerce/http";
import { authorizeCronRequest, runCronCollectionsMonitor } from "@/lib/commerce/monitor-http";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    // Reject invalid cron configuration/authentication before opening storage.
    authorizeCronRequest(request);
    return json(await runCronCollectionsMonitor(commerce(), request));
  } catch (error) {
    return failure(error);
  }
}
