'use client';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import {
  CheckCircle2Icon,
  ChevronDownIcon,
  Loader2Icon,
  UploadIcon,
  VideoIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { toast } from 'sonner';

// Keep in sync with MAX_VIDEO_BYTES in src/lib/r2-presign.ts.
const MAX_VIDEO_BYTES = 2 * 1024 * 1024 * 1024; // 2GB

type UploadState =
  | { status: 'idle' }
  | { status: 'uploading'; progress: number }
  | { status: 'finalizing' }
  | { status: 'done' };

/**
 * Video upload card (PRD F-5 / task #6), shown while status = awaiting_video.
 *
 * Flow: pick a video → POST /api/store/video-upload-url for a presigned R2 PUT
 * → XHR PUT the file directly to R2 with a progress bar → POST
 * /api/store/video-complete to record the key and move to 'building'.
 *
 * Fallback: a collapsible lets the owner paste an external drive link instead
 * (POST /api/store/video-link).
 */
export function VideoUploadCard() {
  const t = useTranslations('Dashboard.store.upload');
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);

  const [upload, setUpload] = useState<UploadState>({ status: 'idle' });
  const [linkValue, setLinkValue] = useState('');
  const [linkSubmitting, setLinkSubmitting] = useState(false);

  const isBusy =
    upload.status === 'uploading' || upload.status === 'finalizing';

  const handleFile = async (file: File) => {
    if (!file.type.startsWith('video/')) {
      toast.error(t('errorNotVideo'));
      return;
    }
    if (file.size > MAX_VIDEO_BYTES) {
      toast.error(t('errorTooLarge'));
      return;
    }

    try {
      // 1. Ask the server for a presigned PUT URL.
      const presignRes = await fetch('/api/store/video-upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type,
          sizeBytes: file.size,
        }),
      });
      if (!presignRes.ok) {
        throw new Error('presign failed');
      }
      const { uploadUrl, key } = (await presignRes.json()) as {
        uploadUrl: string;
        key: string;
      };

      // 2. PUT the file straight to R2 with a progress bar.
      setUpload({ status: 'uploading', progress: 0 });
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhrRef.current = xhr;
        xhr.open('PUT', uploadUrl);
        xhr.setRequestHeader('Content-Type', file.type);
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            const progress = Math.round((event.loaded / event.total) * 100);
            setUpload({ status: 'uploading', progress });
          }
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            reject(new Error(`upload failed (${xhr.status})`));
          }
        };
        xhr.onerror = () => reject(new Error('network error'));
        xhr.onabort = () => reject(new Error('aborted'));
        xhr.send(file);
      });

      // 3. Confirm to the server so it records the key and moves to 'building'.
      setUpload({ status: 'finalizing' });
      const completeRes = await fetch('/api/store/video-complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
      });
      if (!completeRes.ok) {
        throw new Error('complete failed');
      }

      setUpload({ status: 'done' });
      toast.success(t('success'));
      router.refresh();
    } catch (error) {
      console.error('video upload error:', error);
      setUpload({ status: 'idle' });
      toast.error(t('errorUpload'));
    } finally {
      xhrRef.current = null;
    }
  };

  const handleLinkSubmit = async () => {
    const url = linkValue.trim();
    if (!url) {
      return;
    }
    setLinkSubmitting(true);
    try {
      const res = await fetch('/api/store/video-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      if (!res.ok) {
        throw new Error('link failed');
      }
      toast.success(t('linkSuccess'));
      router.refresh();
    } catch (error) {
      console.error('video link error:', error);
      toast.error(t('linkError'));
    } finally {
      setLinkSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <VideoIcon className="size-5 shrink-0" />
          {t('title')}
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {/* Shooting guidance */}
        <div className="rounded-lg border bg-muted/40 p-4 text-sm">
          <p className="font-medium">{t('guideTitle')}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
            <li>{t('guide1')}</li>
            <li>{t('guide2')}</li>
            <li>{t('guide3')}</li>
          </ul>
        </div>

        {/* Upload control */}
        <div className="flex flex-col gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                void handleFile(file);
              }
              // allow re-selecting the same file
              event.target.value = '';
            }}
          />

          {upload.status === 'uploading' && (
            <div className="flex flex-col gap-2">
              <Progress value={upload.progress} className="h-2" />
              <p className="text-sm text-muted-foreground">
                {t('uploading', { progress: upload.progress })}
              </p>
            </div>
          )}

          {upload.status === 'finalizing' && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2Icon className="size-4 animate-spin" />
              {t('finalizing')}
            </p>
          )}

          {upload.status === 'done' && (
            <p className="flex items-center gap-2 text-sm text-green-600">
              <CheckCircle2Icon className="size-4" />
              {t('success')}
            </p>
          )}

          {(upload.status === 'idle' || upload.status === 'uploading') && (
            <Button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isBusy}
              className="w-full sm:w-auto"
            >
              {isBusy ? (
                <Loader2Icon className="mr-2 size-4 animate-spin" />
              ) : (
                <UploadIcon className="mr-2 size-4" />
              )}
              {t('chooseFile')}
            </Button>
          )}
        </div>

        {/* External link fallback */}
        <Collapsible>
          <CollapsibleTrigger className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ChevronDownIcon className="size-4" />
            {t('linkToggle')}
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3 flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">{t('linkHint')}</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                type="url"
                inputMode="url"
                placeholder="https://..."
                value={linkValue}
                onChange={(event) => setLinkValue(event.target.value)}
                disabled={linkSubmitting}
              />
              <Button
                type="button"
                variant="outline"
                onClick={handleLinkSubmit}
                disabled={linkSubmitting || !linkValue.trim()}
              >
                {linkSubmitting && (
                  <Loader2Icon className="mr-2 size-4 animate-spin" />
                )}
                {t('linkSubmit')}
              </Button>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
