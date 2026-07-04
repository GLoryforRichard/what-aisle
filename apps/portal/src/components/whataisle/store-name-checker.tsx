'use client';

import { checkSlugAction } from '@/actions/check-slug';
import { createStoreCheckoutAction } from '@/actions/create-store-checkout';
import { LoginWrapper } from '@/components/auth/login-wrapper';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useCurrentUser } from '@/hooks/use-current-user';
import { useDebouncedCallback } from '@/hooks/use-debounced-callback';
import { useMounted } from '@/hooks/use-mounted';
import { slugify, validateSlug } from '@/lib/slug';
import { cn } from '@/lib/utils';
import {
  ArrowRightIcon,
  CheckCircleIcon,
  Loader2Icon,
  XCircleIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

type CheckState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'available'; slug: string }
  | {
      status: 'unavailable';
      slug: string;
      reason: 'invalid' | 'reserved' | 'taken';
    };

/**
 * Store name checker — the landing page's primary CTA (PRD F-1).
 *
 * Type a supermarket name → live preview of {slug}.whataisle.com +
 * debounced availability check (display only, nothing is created).
 * The CTA starts the signup/checkout flow ($688 setup + $99/mo in
 * ONE Stripe Checkout).
 */
export function StoreNameChecker({ className }: { className?: string }) {
  const t = useTranslations('HomePage.storeChecker');
  const currentUser = useCurrentUser();
  const mounted = useMounted();
  const searchParams = useSearchParams();

  const [storeName, setStoreName] = useState('');
  const [check, setCheck] = useState<CheckState>({ status: 'idle' });
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Guards against out-of-order responses from the debounced check
  const checkSeq = useRef(0);

  // Prefill from ?store= (returning from login or a canceled checkout)
  useEffect(() => {
    const prefill = searchParams.get('store');
    if (prefill) {
      setStoreName(prefill);
      runCheck(prefill);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const runCheck = async (name: string) => {
    const seq = ++checkSeq.current;
    const trimmed = name.trim();
    if (!trimmed) {
      setCheck({ status: 'idle' });
      return;
    }

    // Cheap local validation first (regex + reserved words)
    const slug = slugify(trimmed);
    const validation = validateSlug(slug);
    if (!validation.valid) {
      setCheck({ status: 'unavailable', slug, reason: validation.reason });
      return;
    }

    setCheck({ status: 'checking' });
    const result = await checkSlugAction({ storeName: trimmed });
    if (seq !== checkSeq.current) return; // stale response
    const data = result?.data;
    if (!data) {
      setCheck({ status: 'idle' });
      return;
    }
    if (data.available) {
      setCheck({ status: 'available', slug: data.slug });
    } else {
      setCheck({
        status: 'unavailable',
        slug: data.slug,
        reason: data.reason ?? 'taken',
      });
    }
  };

  const debouncedCheck = useDebouncedCallback(runCheck, 400);

  const handleChange = (value: string) => {
    setStoreName(value);
    const slug = slugify(value.trim());
    // Show the preview instantly; availability comes in async
    if (value.trim()) {
      setCheck({ status: 'checking' });
    } else {
      setCheck({ status: 'idle' });
    }
    if (slug) {
      debouncedCheck(value);
    }
  };

  const handleCheckout = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      const result = await createStoreCheckoutAction({
        storeName: storeName.trim(),
      });
      const data = result?.data;
      if (data?.success && data.data?.url) {
        window.location.href = data.data.url;
        return;
      }
      toast.error(data?.error || t('checkoutFailed'));
      // Re-check: the slug may have just been taken
      runCheck(storeName);
    } catch (error) {
      console.error('store checkout error:', error);
      toast.error(t('checkoutFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const previewSlug =
    check.status === 'available' || check.status === 'unavailable'
      ? check.slug
      : slugify(storeName.trim());
  const showPreview = previewSlug.length > 0;
  const isAvailable = check.status === 'available';
  const canSubmit = isAvailable && !isSubmitting;
  const callbackUrl = `/?store=${encodeURIComponent(storeName.trim())}`;

  const ctaButton = (
    <Button
      size="lg"
      className="h-12 rounded-xl px-6 text-base"
      disabled={!canSubmit}
      onClick={mounted && currentUser ? handleCheckout : undefined}
    >
      {isSubmitting ? (
        <Loader2Icon className="size-4 animate-spin" />
      ) : (
        <>
          <span className="text-nowrap">{t('cta')}</span>
          <ArrowRightIcon className="size-4" />
        </>
      )}
    </Button>
  );

  return (
    <div className={cn('mx-auto w-full max-w-xl', className)}>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Input
          value={storeName}
          onChange={(e) => handleChange(e.target.value)}
          placeholder={t('placeholder')}
          className="h-12 flex-1 rounded-xl text-base"
          aria-label={t('placeholder')}
        />
        {mounted && !currentUser && canSubmit ? (
          <LoginWrapper mode="modal" asChild callbackUrl={callbackUrl}>
            {ctaButton}
          </LoginWrapper>
        ) : (
          ctaButton
        )}
      </div>

      {/* live preview + availability state */}
      <div className="mt-3 flex min-h-6 items-center justify-center gap-2 text-sm">
        {showPreview && (
          <>
            <span className="font-mono text-foreground">
              {previewSlug}
              <span className="text-muted-foreground">.whataisle.com</span>
            </span>
            {check.status === 'checking' && (
              <span className="flex items-center gap-1 text-muted-foreground">
                <Loader2Icon className="size-3.5 animate-spin" />
                {t('checking')}
              </span>
            )}
            {check.status === 'available' && (
              <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
                <CheckCircleIcon className="size-3.5" />
                {t('available')}
              </span>
            )}
            {check.status === 'unavailable' && (
              <span className="flex items-center gap-1 text-red-600 dark:text-red-400">
                <XCircleIcon className="size-3.5" />
                {t(check.reason)}
              </span>
            )}
          </>
        )}
        {!showPreview && (
          <span className="text-muted-foreground">{t('hint')}</span>
        )}
      </div>
    </div>
  );
}
