import { handleResendWebhook } from "../handler";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleResendWebhook(request, "inbound");
}
