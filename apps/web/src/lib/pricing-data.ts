import type { Tier } from '@/hooks/use-feature';

export interface TierPricing {
  monthly: number | null;
  annual: number | null;
  popular?: boolean;
  description: string;
}

export interface FeatureRow {
  name: string;
  category: 'limits' | 'features' | 'support';
  free: string | boolean;
  pro: string | boolean;
  team: string | boolean;
  enterprise: string | boolean;
}

export const TIER_PRICING: Record<Tier, TierPricing> = {
  free: {
    monthly: 0,
    annual: 0,
    description: 'For side projects and learning',
  },
  pro: {
    monthly: 12,
    annual: 8.40,
    popular: true,
    description: 'For professional developers',
  },
  team: {
    monthly: 21,
    annual: 17.50,
    description: 'For growing teams',
  },
  enterprise: {
    monthly: null,
    annual: null,
    description: 'For large organizations',
  },
};

export const FEATURE_COMPARISON: FeatureRow[] = [
  // Limits
  { name: 'Events per minute', category: 'limits', free: '5', pro: '60', team: '300', enterprise: '3,000+' },
  { name: 'Projects', category: 'limits', free: '1', pro: 'Unlimited', team: 'Unlimited', enterprise: 'Unlimited' },
  { name: 'Data retention', category: 'limits', free: '7 days', pro: '30 days', team: '90 days', enterprise: 'Custom' },
  { name: 'AI fixes included', category: 'limits', free: '0', pro: '10/month', team: '50/month', enterprise: 'Unlimited' },

  // Features
  { name: 'Email alerts', category: 'features', free: true, pro: true, team: true, enterprise: true },
  { name: 'Webhook alerts', category: 'features', free: false, pro: true, team: true, enterprise: true },
  { name: 'Slack integration', category: 'features', free: false, pro: true, team: true, enterprise: true },
  { name: 'Team members', category: 'features', free: false, pro: false, team: true, enterprise: true },
  { name: 'Jira integration', category: 'features', free: false, pro: false, team: true, enterprise: true },
  { name: 'Linear integration', category: 'features', free: false, pro: false, team: true, enterprise: true },
  { name: 'GitHub integration', category: 'features', free: false, pro: false, team: true, enterprise: true },
  { name: 'SSO/SAML', category: 'features', free: false, pro: false, team: false, enterprise: true },
  { name: 'Audit logs', category: 'features', free: false, pro: false, team: false, enterprise: true },

  // Support
  { name: 'Community support', category: 'support', free: true, pro: true, team: true, enterprise: true },
  { name: 'Priority support', category: 'support', free: false, pro: true, team: true, enterprise: true },
  { name: 'Dedicated support', category: 'support', free: false, pro: false, team: false, enterprise: true },
  { name: 'SLA guarantee', category: 'support', free: false, pro: false, team: false, enterprise: true },
];

export const TIER_ORDER: Tier[] = ['free', 'pro', 'team', 'enterprise'];

export function getTierIndex(tier: Tier): number {
  return TIER_ORDER.indexOf(tier);
}

export function isUpgrade(currentTier: Tier, targetTier: Tier): boolean {
  return getTierIndex(targetTier) > getTierIndex(currentTier);
}

export function isDowngrade(currentTier: Tier, targetTier: Tier): boolean {
  return getTierIndex(targetTier) < getTierIndex(currentTier);
}

export function getAnnualSavings(tier: Tier): number {
  const pricing = TIER_PRICING[tier];
  if (!pricing.monthly || !pricing.annual) return 0;
  return Math.round((1 - pricing.annual / pricing.monthly) * 100);
}
