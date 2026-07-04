import { Ripple } from '@/components/magicui/ripple';
import { AnimatedGroup } from '@/components/tailark/motion/animated-group';
import { TextEffect } from '@/components/tailark/motion/text-effect';
import { Button } from '@/components/ui/button';
import { StoreNameChecker } from '@/components/whataisle/store-name-checker';
import { LocaleLink } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { Suspense } from 'react';

const transitionVariants = {
  item: {
    hidden: {
      opacity: 0,
      y: 12,
      scale: 0.95,
    },
    visible: {
      opacity: 1,
      y: 0,
      scale: 1,
      transition: {
        type: 'spring' as const,
        bounce: 0,
        duration: 0.8,
      },
    },
  },
};

export default function HeroSection() {
  const t = useTranslations('HomePage.hero');

  return (
    <section id="hero" className="overflow-hidden">
      {/* background, light shadows on top of the hero section */}
      <div
        aria-hidden
        className="absolute inset-0 isolate hidden opacity-65 contain-strict lg:block"
      >
        <div className="w-140 h-320 -translate-y-87.5 absolute left-0 top-0 -rotate-45 rounded-full bg-[radial-gradient(68.54%_68.72%_at_55.02%_31.46%,oklch(0.85_0.04_55/.12)_0,oklch(0.7_0.02_45/.04)_50%,transparent_80%)]" />
        <div className="h-320 absolute left-0 top-0 w-60 -rotate-45 rounded-full bg-[radial-gradient(50%_50%_at_50%_50%,oklch(0.88_0.05_38/.1)_0,oklch(0.6_0.02_38/.03)_80%,transparent_100%)] [translate:5%_-50%]" />
        <div className="h-320 -translate-y-87.5 absolute left-0 top-0 w-60 -rotate-45 bg-[radial-gradient(50%_50%_at_50%_50%,oklch(0.9_0.03_65/.08)_0,oklch(0.65_0.015_50/.03)_80%,transparent_100%)]" />
      </div>

      <div className="relative pt-12 pb-16 md:pb-24">
        <div className="mx-auto max-w-7xl px-6">
          <Ripple />

          <div className="text-center sm:mx-auto lg:mr-auto lg:mt-0">
            {/* introduction */}
            <AnimatedGroup variants={transitionVariants}>
              <LocaleLink
                href="/#pricing"
                className="hover:bg-muted group mx-auto flex w-fit items-center gap-2 rounded-full border border-border p-1 px-4 transition-colors"
              >
                <span className="text-sm text-foreground font-medium">
                  {t('introduction')}
                </span>
              </LocaleLink>
            </AnimatedGroup>

            {/* title */}
            <TextEffect
              per="line"
              preset="fade-in-blur"
              speedSegment={0.3}
              as="h1"
              className="mt-8 text-balance text-5xl font-bricolage-grotesque lg:mt-16 xl:text-[5rem]"
            >
              {t('title')}
            </TextEffect>

            {/* description */}
            <TextEffect
              per="line"
              preset="fade-in-blur"
              speedSegment={0.3}
              delay={0.5}
              as="p"
              className="mx-auto mt-8 max-w-4xl text-balance text-lg text-muted-foreground"
            >
              {t('description')}
            </TextEffect>

            {/* store name checker — the primary CTA (PRD F-1) */}
            <AnimatedGroup
              variants={{
                container: {
                  visible: {
                    transition: {
                      staggerChildren: 0.05,
                      delayChildren: 0.75,
                    },
                  },
                },
                ...transitionVariants,
              }}
              className="mt-12"
            >
              <Suspense fallback={null}>
                <StoreNameChecker />
              </Suspense>
            </AnimatedGroup>

            {/* secondary action */}
            <AnimatedGroup
              variants={{
                container: {
                  visible: {
                    transition: {
                      staggerChildren: 0.05,
                      delayChildren: 0.9,
                    },
                  },
                },
                ...transitionVariants,
              }}
              className="mt-8 flex flex-row items-center justify-center gap-4"
            >
              <Button
                asChild
                size="lg"
                variant="outline"
                className="h-10.5 rounded-xl px-5"
              >
                <LocaleLink href="/#pricing">
                  <span className="text-nowrap">{t('secondary')}</span>
                </LocaleLink>
              </Button>
            </AnimatedGroup>
          </div>
        </div>
      </div>
    </section>
  );
}
