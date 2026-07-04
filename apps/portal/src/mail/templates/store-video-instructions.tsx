import { defaultMessages } from '@/i18n/messages';
import { routing } from '@/i18n/routing';
import EmailButton from '@/mail/components/email-button';
import EmailLayout from '@/mail/components/email-layout';
import type { BaseEmailProps } from '@/mail/types';
import { Text } from '@react-email/components';
import { createTranslator } from 'use-intl/core';

interface StoreVideoInstructionsProps extends BaseEmailProps {
  storeName: string;
  slug: string;
  dashboardUrl: string;
}

/**
 * Sent to a store owner right after a successful checkout:
 * how to shoot the store layout video + where to upload it (PRD 3.3).
 */
export default function StoreVideoInstructions({
  storeName,
  slug,
  dashboardUrl,
  locale,
  messages,
}: StoreVideoInstructionsProps) {
  const t = createTranslator({
    locale,
    messages,
    namespace: 'Mail.storeVideoInstructions',
  });

  return (
    <EmailLayout locale={locale} messages={messages}>
      <Text>{t('title', { storeName })}</Text>
      <Text>{t('body', { domain: `${slug}.whataisle.com` })}</Text>
      <Text>{t('step1')}</Text>
      <Text>{t('step2')}</Text>
      <Text>{t('step3')}</Text>
      <Text>{t('outro')}</Text>
      <EmailButton href={dashboardUrl}>{t('uploadVideo')}</EmailButton>
    </EmailLayout>
  );
}

StoreVideoInstructions.PreviewProps = {
  locale: routing.defaultLocale,
  messages: defaultMessages,
  storeName: 'Ethnic Market',
  slug: 'ethnic-market',
  dashboardUrl: 'https://whataisle.com/dashboard',
};
