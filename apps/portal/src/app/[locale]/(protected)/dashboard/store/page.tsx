import { DashboardHeader } from '@/components/dashboard/dashboard-header';
import { CustomerPortalButton } from '@/components/pricing/customer-portal-button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { ResetPasscodeButton } from '@/components/whataisle/reset-passcode-button';
import { VideoUploadCard } from '@/components/whataisle/video-upload-card';
import { LocaleLink } from '@/i18n/navigation';
import { getSession } from '@/lib/server';
import { getOwnedStore } from '@/lib/store-owner';
import { STORE_STATUS, type StoreStatus } from '@/lib/store-status';
import { Routes } from '@/routes';
import { cn } from '@/lib/utils';
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  ExternalLinkIcon,
  HammerIcon,
  StoreIcon,
} from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';

/**
 * Store-owner onboarding dashboard (PRD 4.1 F-5 / task #6).
 *
 * Server component: loads the caller's OWN store (getOwnedStore filters on
 * session.user.id) and renders a five-state stepper plus the state-specific
 * card. A user without a store gets a CTA back to the landing store-name
 * checker.
 */

// Stepper order; 'suspended' and 'canceled' are handled distinctly.
const STEPPER_STATUSES: StoreStatus[] = [
  STORE_STATUS.AWAITING_VIDEO, // "已付款" is the entry — payment already done
  STORE_STATUS.BUILDING,
  STORE_STATUS.LIVE,
];

function getStoreBaseDomain(): string {
  return process.env.NEXT_PUBLIC_STORE_BASE_DOMAIN || 'what-aisle.com';
}

export default async function StoreDashboardPage() {
  const session = await getSession();
  if (!session?.user) {
    redirect(Routes.Login);
  }

  const t = await getTranslations('Dashboard.store');
  const store = await getOwnedStore(session.user.id);

  const breadcrumbs = [{ label: t('title'), isCurrentPage: true }];

  // No store yet → CTA back to the landing checker.
  if (!store) {
    return (
      <>
        <DashboardHeader breadcrumbs={breadcrumbs} />
        <div className="flex flex-1 flex-col p-4 lg:p-6">
          <Card className="mx-auto w-full max-w-xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <StoreIcon className="size-5 shrink-0" />
                {t('empty.title')}
              </CardTitle>
              <CardDescription>{t('empty.description')}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild>
                <LocaleLink href={Routes.Root}>{t('empty.cta')}</LocaleLink>
              </Button>
            </CardContent>
          </Card>
        </div>
      </>
    );
  }

  const status = store.status;
  const isCanceled = status === STORE_STATUS.CANCELED;
  const isSuspended = status === STORE_STATUS.SUSPENDED;
  const isLive = status === STORE_STATUS.LIVE;
  const storeUrl = `https://${store.slug}.${getStoreBaseDomain()}`;

  // Which step is "current" for the stepper highlight.
  const activeStep = STEPPER_STATUSES.indexOf(
    isLive || isSuspended ? STORE_STATUS.LIVE : (status as StoreStatus)
  );

  return (
    <>
      <DashboardHeader breadcrumbs={breadcrumbs} />
      <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
        {/* Header */}
        <div className="flex flex-col gap-1">
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <StoreIcon className="size-6 shrink-0" />
            {store.name}
          </h1>
          <p className="text-sm text-muted-foreground">
            {store.slug}.{getStoreBaseDomain()}
          </p>
        </div>

        {/* Stepper */}
        <div className="flex flex-col gap-3 rounded-lg border p-4">
          <ol className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-0">
            {/* Payment is implicitly the first (already-done) step. */}
            <StepDot label={t('steps.paid')} state="done" isFirst />
            {STEPPER_STATUSES.map((step, index) => {
              const state =
                index < activeStep
                  ? 'done'
                  : index === activeStep && !isSuspended
                    ? 'current'
                    : index === activeStep && isSuspended
                      ? 'suspended'
                      : 'upcoming';
              return (
                <StepDot
                  key={step}
                  label={
                    step === STORE_STATUS.AWAITING_VIDEO
                      ? t('steps.awaitingVideo')
                      : step === STORE_STATUS.BUILDING
                        ? t('steps.building')
                        : isSuspended
                          ? t('steps.suspended')
                          : t('steps.live')
                  }
                  state={state as StepState}
                />
              );
            })}
          </ol>
        </div>

        {/* Canceled: terminal, distinct notice. */}
        {isCanceled && (
          <Alert variant="destructive">
            <AlertTriangleIcon className="size-4" />
            <AlertTitle>{t('canceled.title')}</AlertTitle>
            <AlertDescription>{t('canceled.description')}</AlertDescription>
          </Alert>
        )}

        {/* awaiting_video: upload card. */}
        {status === STORE_STATUS.AWAITING_VIDEO && <VideoUploadCard />}

        {/* building: waiting state. */}
        {status === STORE_STATUS.BUILDING && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <HammerIcon className="size-5 shrink-0" />
                {t('building.title')}
              </CardTitle>
              <CardDescription>{t('building.description')}</CardDescription>
            </CardHeader>
            <CardContent>
              {store.videoExternalUrl ? (
                <p className="text-sm text-muted-foreground">
                  {t('building.receivedLink')}{' '}
                  <a
                    href={store.videoExternalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="break-all underline"
                  >
                    {store.videoExternalUrl}
                  </a>
                </p>
              ) : store.videoR2Key ? (
                <p className="text-sm text-muted-foreground">
                  {t('building.receivedFile')}{' '}
                  <code className="break-all">
                    {store.videoR2Key.split('/').pop()}
                  </code>
                </p>
              ) : null}
            </CardContent>
          </Card>
        )}

        {/* live: subdomain + admin passcode. */}
        {isLive && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle2Icon className="size-5 shrink-0 text-green-600" />
                {t('live.title')}
              </CardTitle>
              <CardDescription>{t('live.description')}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-6">
              <div className="flex flex-col gap-2">
                <p className="text-sm font-medium">{t('live.urlLabel')}</p>
                <Button asChild variant="outline" className="w-full sm:w-auto">
                  <a href={storeUrl} target="_blank" rel="noopener noreferrer">
                    {storeUrl}
                    <ExternalLinkIcon className="ml-2 size-4" />
                  </a>
                </Button>
              </div>

              <div className="flex flex-col gap-2">
                <p className="text-sm font-medium">{t('live.adminLabel')}</p>
                <p className="text-sm text-muted-foreground">
                  {t('live.adminHint', { url: `${storeUrl}/admin` })}
                </p>
                <ResetPasscodeButton />
              </div>
            </CardContent>
          </Card>
        )}

        {/* suspended: billing problem + subscription management. */}
        {isSuspended && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangleIcon className="size-5 shrink-0 text-destructive" />
                {t('suspended.title')}
              </CardTitle>
              <CardDescription>{t('suspended.description')}</CardDescription>
            </CardHeader>
            <CardContent>
              <CustomerPortalButton userId={session.user.id}>
                {t('manageSubscription')}
              </CustomerPortalButton>
            </CardContent>
          </Card>
        )}

        {/* Subscription management (reuse Stripe Customer Portal) —
            always available except when the row is canceled. */}
        {!isCanceled && !isSuspended && (
          <Card>
            <CardHeader>
              <CardTitle>{t('billing.title')}</CardTitle>
              <CardDescription>{t('billing.description')}</CardDescription>
            </CardHeader>
            <CardContent>
              <CustomerPortalButton userId={session.user.id} variant="outline">
                {t('manageSubscription')}
              </CustomerPortalButton>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}

type StepState = 'done' | 'current' | 'upcoming' | 'suspended';

function StepDot({
  label,
  state,
  isFirst,
}: {
  label: string;
  state: StepState;
  isFirst?: boolean;
}) {
  return (
    <li className="flex flex-1 items-center gap-3 sm:flex-col sm:gap-2">
      {!isFirst && (
        <span className="hidden h-px flex-1 bg-border sm:block" aria-hidden />
      )}
      <span className="flex items-center gap-3 sm:flex-col sm:gap-2">
        <span
          className={cn(
            'flex size-8 shrink-0 items-center justify-center rounded-full border text-xs font-medium',
            state === 'done' && 'border-green-600 bg-green-600 text-white',
            state === 'current' &&
              'border-primary bg-primary text-primary-foreground',
            state === 'suspended' &&
              'border-destructive bg-destructive text-white',
            state === 'upcoming' && 'border-border text-muted-foreground'
          )}
        >
          {state === 'done' ? (
            <CheckCircle2Icon className="size-4" />
          ) : state === 'suspended' ? (
            <AlertTriangleIcon className="size-4" />
          ) : null}
        </span>
        <span
          className={cn(
            'text-sm',
            state === 'upcoming'
              ? 'text-muted-foreground'
              : 'font-medium text-foreground'
          )}
        >
          {label}
        </span>
      </span>
    </li>
  );
}
