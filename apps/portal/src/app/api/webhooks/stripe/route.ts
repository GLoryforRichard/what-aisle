import { handleWebhookEvent } from '@/payment';
import { type NextRequest, NextResponse } from 'next/server';

/**
 * Stripe webhook handler
 * This endpoint receives webhook events from Stripe and processes them
 *
 * @param req The incoming request
 * @returns NextResponse
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  // Get the request body as text
  const payload = await req.text();

  // Get the Stripe signature from headers
  const signature = req.headers.get('stripe-signature') || '';

  try {
    // Validate inputs
    if (!payload || !signature) {
      console.warn('Stripe webhook: missing payload or signature');
      return NextResponse.json(
        { error: 'Missing payload or signature' },
        { status: 400 }
      );
    }

    // Process the webhook event
    await handleWebhookEvent(payload, signature);

    // Return success
    return NextResponse.json({ received: true }, { status: 200 });
  } catch (error) {
    console.error('Error in webhook route:', error);

    // Bad signature: retrying will never help — reject with 400.
    if (
      error instanceof Error &&
      error.message === 'Invalid webhook signature'
    ) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }

    // IMPORTANT: Return 5xx on processing errors so Stripe REDELIVERS the
    // event (retries with backoff for up to 3 days). Every handler is
    // idempotent (unique invoiceId constraint, status-guarded updates), so
    // replays are safe — whereas acking 200 on a failed DB transition would
    // silently drop a paid customer with no retry and no signal.
    return NextResponse.json(
      { error: 'Webhook handler failed' },
      { status: 500 }
    );
  }
}
