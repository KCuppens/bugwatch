'use client';

import { useAuth } from '@/lib/auth-context';

export type Tier = 'free' | 'pro' | 'team' | 'enterprise';

const TIER_LEVELS: Record<Tier, number> = {
  free: 0,
  pro: 1,
  team: 2,
  enterprise: 3,
};

const FEATURE_TIERS: Record<string, Tier> = {
  // Pro features
  webhooks: 'pro',
  pagerduty: 'pro',
  opsgenie: 'pro',
  slack_advanced: 'pro',
  slack: 'pro',

  // Team features
  session_replay: 'team',
  performance_monitoring: 'team',
  jira: 'team',
  linear: 'team',
  github: 'team',
  team_members: 'team',

  // Enterprise features
  sso: 'enterprise',
  audit_logs: 'enterprise',
  custom_retention: 'enterprise',
};

/**
 * Human-readable display names for features
 */
export const FEATURE_DISPLAY_NAMES: Record<string, string> = {
  webhooks: 'Webhook Alerts',
  pagerduty: 'PagerDuty Integration',
  opsgenie: 'OpsGenie Integration',
  slack_advanced: 'Advanced Slack Features',
  slack: 'Slack Integration',
  session_replay: 'Session Replay',
  performance_monitoring: 'Performance Monitoring',
  jira: 'Jira Integration',
  linear: 'Linear Integration',
  github: 'GitHub Integration',
  team_members: 'Team Members',
  sso: 'SSO/SAML',
  audit_logs: 'Audit Logs',
  custom_retention: 'Custom Retention',
};

/**
 * Get human-readable display name for a feature
 */
export function getFeatureDisplayName(feature: string): string {
  return FEATURE_DISPLAY_NAMES[feature] || feature;
}

/**
 * Check if a specific feature is available for the current user's tier
 */
export function useFeature(feature: string): boolean {
  const { user } = useAuth();
  const userTier = (user?.organization?.tier || 'free') as Tier;
  const requiredTier = FEATURE_TIERS[feature] || 'free';
  return TIER_LEVELS[userTier] >= TIER_LEVELS[requiredTier];
}

/**
 * Get tier information and helper functions
 */
export function useTier(): {
  tier: Tier;
  hasAccess: (requiredTier: Tier) => boolean;
  isPro: boolean;
  isTeam: boolean;
  isEnterprise: boolean;
} {
  const { user } = useAuth();
  const tier = (user?.organization?.tier || 'free') as Tier;

  return {
    tier,
    hasAccess: (required: Tier) => TIER_LEVELS[tier] >= TIER_LEVELS[required],
    isPro: TIER_LEVELS[tier] >= TIER_LEVELS['pro'],
    isTeam: TIER_LEVELS[tier] >= TIER_LEVELS['team'],
    isEnterprise: tier === 'enterprise',
  };
}

/**
 * Get display name for a tier
 */
export function getTierDisplayName(tier: string): string {
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

/**
 * Get pricing for a tier (per seat per month)
 */
export function getTierPrice(tier: Tier, annual: boolean = false): number {
  const prices: Record<Tier, { monthly: number; annual: number }> = {
    free: { monthly: 0, annual: 0 },
    pro: { monthly: 12, annual: 10 },
    team: { monthly: 25, annual: 21 },
    enterprise: { monthly: 0, annual: 0 }, // Custom pricing
  };
  return annual ? prices[tier].annual : prices[tier].monthly;
}

/**
 * Get rate limit for a tier (events per minute)
 */
export function getTierRateLimit(tier: Tier): number {
  const limits: Record<Tier, number> = {
    free: 5,
    pro: 60,
    team: 300,
    enterprise: 3000,
  };
  return limits[tier];
}

/**
 * Get the required tier for a feature
 */
export function getFeatureTier(feature: string): Tier {
  return FEATURE_TIERS[feature] || 'free';
}
