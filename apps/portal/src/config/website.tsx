import { PaymentTypes, PlanIntervals } from '@/payment/types';
import type { PaymentConfig, WebsiteConfig } from '@/types';

const isE2ETestMode = process.env.NEXT_PUBLIC_E2E_TEST_MODE === 'true';

// Payment provider controlled by env var: 'stripe' | 'creem'
const paymentProvider = (process.env.NEXT_PUBLIC_PAYMENT_PROVIDER ||
  'stripe') as PaymentConfig['provider'];
const isCreem = paymentProvider === 'creem';

// Resolve price/product IDs based on the active payment provider
const priceIds = {
  proMonthly: isCreem
    ? process.env.NEXT_PUBLIC_CREEM_PRODUCT_PRO_MONTHLY!
    : process.env.NEXT_PUBLIC_STRIPE_PRICE_PRO_MONTHLY!,
  proYearly: isCreem
    ? process.env.NEXT_PUBLIC_CREEM_PRODUCT_PRO_YEARLY!
    : process.env.NEXT_PUBLIC_STRIPE_PRICE_PRO_YEARLY!,
  lifetime: isCreem
    ? process.env.NEXT_PUBLIC_CREEM_PRODUCT_LIFETIME!
    : process.env.NEXT_PUBLIC_STRIPE_PRICE_LIFETIME!,
  creditsBasic: isCreem
    ? process.env.NEXT_PUBLIC_CREEM_PRODUCT_CREDITS_BASIC!
    : process.env.NEXT_PUBLIC_STRIPE_PRICE_CREDITS_BASIC!,
  creditsStandard: isCreem
    ? process.env.NEXT_PUBLIC_CREEM_PRODUCT_CREDITS_STANDARD!
    : process.env.NEXT_PUBLIC_STRIPE_PRICE_CREDITS_STANDARD!,
  creditsPremium: isCreem
    ? process.env.NEXT_PUBLIC_CREEM_PRODUCT_CREDITS_PREMIUM!
    : process.env.NEXT_PUBLIC_STRIPE_PRICE_CREDITS_PREMIUM!,
  creditsEnterprise: isCreem
    ? process.env.NEXT_PUBLIC_CREEM_PRODUCT_CREDITS_ENTERPRISE!
    : process.env.NEXT_PUBLIC_STRIPE_PRICE_CREDITS_ENTERPRISE!,
  // What-Aisle: $99/mo subscription + $688 one-time setup fee (Stripe only)
  whataisleMonthly: process.env.NEXT_PUBLIC_STRIPE_PRICE_WHATAISLE_MONTHLY!,
  whataisleSetup: process.env.NEXT_PUBLIC_STRIPE_PRICE_WHATAISLE_SETUP!,
};

/**
 * website config, without translations
 *
 * docs:
 * https://mksaas.com/docs/config/website
 */
export const websiteConfig: WebsiteConfig = {
  ui: {
    mode: {
      defaultMode: 'dark',
      enableSwitch: true,
    },
  },
  metadata: {
    images: {
      ogImage: '/og.png',
      logoLight: '/logo.png',
      logoDark: '/logo-dark.png',
    },
    social: {
      github: 'https://github.com/MkSaaSHQ',
      twitter: 'https://mksaas.link/twitter',
      blueSky: 'https://mksaas.link/bsky',
      discord: 'https://mksaas.link/discord',
      mastodon: 'https://mksaas.link/mastodon',
      linkedin: 'https://mksaas.link/linkedin',
      youtube: 'https://mksaas.link/youtube',
    },
  },
  features: {
    enableUpgradeCard: true,
    enableUpdateAvatar: true,
    enableDatafastRevenueTrack: false,
    enableCrispChat: process.env.NEXT_PUBLIC_DEMO_WEBSITE === 'true',
    enableTurnstileCaptcha:
      process.env.NEXT_PUBLIC_DEMO_WEBSITE === 'true' && !isE2ETestMode,
  },
  affiliates: {
    enable: false,
    provider: 'affonso',
  },
  analytics: {
    enableVercelAnalytics: false,
    enableSpeedInsights: false,
  },
  apikeys: {
    enable: process.env.NEXT_PUBLIC_DEMO_WEBSITE === 'true',
  },
  auth: {
    enableGoogleLogin: true,
    // GitHub OAuth is meaningless for supermarket owners (PRD F-2) — UI only,
    // server-side config is kept so existing linked accounts keep working
    enableGithubLogin: false,
    enableCredentialLogin: true,
    enableDeleteUser: true,
  },
  i18n: {
    defaultLocale: 'en',
    locales: {
      en: {
        flag: '🇺🇸',
        name: 'English',
        hreflang: 'en',
      },
      zh: {
        flag: '🇨🇳',
        name: '中文',
        hreflang: 'zh-CN',
      },
    },
  },
  blog: {
    // hidden from nav/footer for What-Aisle (PRD F-6) — code kept
    enable: false,
    paginationSize: 6,
    relatedPostsSize: 3,
  },
  docs: {
    // hidden from nav/footer for What-Aisle (PRD F-6) — code kept
    enable: false,
  },
  mail: {
    enable: true,
    provider: 'resend',
    fromEmail: 'What-Aisle <support@what-aisle.com>',
    supportEmail: 'What-Aisle <support@what-aisle.com>',
  },
  newsletter: {
    enable: true,
    provider: 'resend',
    autoSubscribeAfterSignUp: true,
  },
  notification: {
    enable: true,
    provider: 'discord',
  },
  storage: {
    enable: true,
    provider: 's3',
  },
  payment: {
    provider: paymentProvider,
  },
  price: {
    plans: {
      // What-Aisle: ONE checkout = $99/mo subscription + $688 one-time
      // setup fee ("white-glove onboarding", PRD F-3 / 8.3)
      whataisle: {
        id: 'whataisle',
        prices: [
          {
            type: PaymentTypes.SUBSCRIPTION,
            priceId: priceIds.whataisleMonthly,
            amount: 9900,
            currency: 'USD',
            interval: PlanIntervals.MONTH,
          },
        ],
        setupFeePriceId: priceIds.whataisleSetup,
        setupFeeAmount: 68800,
        isFree: false,
        isLifetime: false,
        popular: true,
        credits: {
          enable: false,
          amount: 0,
        },
      },
      // Template plans below are hidden (disabled), not deleted (PRD F-6)
      free: {
        id: 'free',
        disabled: true,
        prices: [],
        isFree: true,
        isLifetime: false,
        credits: {
          enable: true,
          amount: 50,
          expireDays: 30,
        },
      },
      pro: {
        id: 'pro',
        disabled: true,
        prices: [
          {
            type: PaymentTypes.SUBSCRIPTION,
            priceId: priceIds.proMonthly,
            amount: 990,
            currency: 'USD',
            interval: PlanIntervals.MONTH,
          },
          {
            type: PaymentTypes.SUBSCRIPTION,
            priceId: priceIds.proYearly,
            amount: 9900,
            currency: 'USD',
            interval: PlanIntervals.YEAR,
          },
        ],
        isFree: false,
        isLifetime: false,
        credits: {
          enable: true,
          amount: 1000,
          expireDays: 30,
        },
      },
      lifetime: {
        id: 'lifetime',
        disabled: true,
        prices: [
          {
            type: PaymentTypes.ONE_TIME,
            priceId: priceIds.lifetime,
            amount: 19900,
            currency: 'USD',
            allowPromotionCode: true,
          },
        ],
        isFree: false,
        isLifetime: true,
        credits: {
          enable: true,
          amount: 1000,
          expireDays: 30,
        },
      },
    },
  },
  credits: {
    enableCredits: process.env.NEXT_PUBLIC_DEMO_WEBSITE === 'true',
    enablePackagesForFreePlan: false,
    registerGiftCredits: {
      enable: true,
      amount: 50,
      expireDays: 30,
    },
    packages: {
      basic: {
        id: 'basic',
        popular: false,
        amount: 100,
        expireDays: 30,
        price: {
          priceId: priceIds.creditsBasic,
          amount: 990,
          currency: 'USD',
          allowPromotionCode: true,
        },
      },
      standard: {
        id: 'standard',
        popular: true,
        amount: 200,
        expireDays: 30,
        price: {
          priceId: priceIds.creditsStandard,
          amount: 1490,
          currency: 'USD',
          allowPromotionCode: true,
        },
      },
      premium: {
        id: 'premium',
        popular: false,
        amount: 500,
        expireDays: 30,
        price: {
          priceId: priceIds.creditsPremium,
          amount: 3990,
          currency: 'USD',
          allowPromotionCode: true,
        },
      },
      enterprise: {
        id: 'enterprise',
        popular: false,
        amount: 1000,
        expireDays: 30,
        price: {
          priceId: priceIds.creditsEnterprise,
          amount: 6990,
          currency: 'USD',
          allowPromotionCode: true,
        },
      },
    },
  },
};
