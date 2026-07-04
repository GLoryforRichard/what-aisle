'use client';

import { Button } from '@/components/ui/button';
import { CheckIcon, CopyIcon, KeyRoundIcon, Loader2Icon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

/**
 * Reset the staff /admin passcode for a live store (PRD F-5 / task #6).
 *
 * Calls POST /api/store/reset-passcode and surfaces the new passcode ONCE —
 * the Stores App only keeps a hash, so it can never be shown again.
 */
export function ResetPasscodeButton() {
  const t = useTranslations('Dashboard.store.live.passcode');
  const [isLoading, setIsLoading] = useState(false);
  const [passcode, setPasscode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleReset = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/store/reset-passcode', { method: 'POST' });
      if (!res.ok) {
        throw new Error('reset failed');
      }
      const { passcode: next } = (await res.json()) as { passcode: string };
      setPasscode(next);
      setCopied(false);
      toast.success(t('success'));
    } catch (error) {
      console.error('reset passcode error:', error);
      toast.error(t('error'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!passcode) {
      return;
    }
    try {
      await navigator.clipboard.writeText(passcode);
      setCopied(true);
      toast.success(t('copied'));
    } catch {
      // clipboard may be unavailable; the value is still shown on screen
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <Button
        type="button"
        variant="outline"
        onClick={handleReset}
        disabled={isLoading}
        className="w-full sm:w-auto"
      >
        {isLoading ? (
          <Loader2Icon className="mr-2 size-4 animate-spin" />
        ) : (
          <KeyRoundIcon className="mr-2 size-4" />
        )}
        {t('button')}
      </Button>

      {passcode && (
        <div className="flex flex-col gap-2 rounded-lg border bg-muted/40 p-4">
          <p className="text-sm text-muted-foreground">{t('once')}</p>
          <div className="flex items-center gap-2">
            <code className="rounded bg-background px-3 py-2 font-mono text-lg tracking-widest">
              {passcode}
            </code>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={handleCopy}
              aria-label={t('copy')}
            >
              {copied ? (
                <CheckIcon className="size-4" />
              ) : (
                <CopyIcon className="size-4" />
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
