'use client';

import { useState, useEffect } from 'react';
import { Mail, Webhook, MessageSquare, Bell, Shield, Check } from 'lucide-react';
import { alertsApi, NotificationChannel } from '@/lib/api';
import { useFeature } from '@/hooks/use-feature';
import { ProBadge } from '@/components/pro-badge';

interface ChannelSelectorProps {
  selectedChannels: string[];
  onSelect: (ids: string[]) => void;
  projectId: string;
}

type ChannelMeta = { icon: React.ReactNode; label: string; feature?: string };

const CHANNEL_TYPE_META: Record<string, ChannelMeta> = {
  email: { icon: <Mail className="h-4 w-4" />, label: 'Email', feature: 'email_notifications' },
  webhook: { icon: <Webhook className="h-4 w-4" />, label: 'Webhook', feature: 'webhooks' },
  slack: { icon: <MessageSquare className="h-4 w-4" />, label: 'Slack' },
  pagerduty: { icon: <Bell className="h-4 w-4" />, label: 'PagerDuty', feature: 'pagerduty' },
  opsgenie: { icon: <Shield className="h-4 w-4" />, label: 'OpsGenie', feature: 'opsgenie' },
};

export function ChannelSelector({ selectedChannels, onSelect, projectId }: ChannelSelectorProps) {
  const [channels, setChannels] = useState<NotificationChannel[]>([]);
  const [loading, setLoading] = useState(true);

  const hasPagerDuty = useFeature('pagerduty');
  const hasOpsGenie = useFeature('opsgenie');
  const hasEmail = useFeature('email_notifications');
  const hasWebhooks = useFeature('webhooks');

  useEffect(() => {
    async function loadChannels() {
      try {
        const data = await alertsApi.listChannels(projectId);
        setChannels(Array.isArray(data) ? data : []);
      } catch {
        setChannels([]);
      } finally {
        setLoading(false);
      }
    }
    loadChannels();
  }, [projectId]);

  const toggleChannel = (channelId: string) => {
    if (selectedChannels.includes(channelId)) {
      onSelect(selectedChannels.filter((id) => id !== channelId));
    } else {
      onSelect([...selectedChannels, channelId]);
    }
  };

  const isFeatureAvailable = (channelType: string): boolean => {
    switch (channelType) {
      case 'pagerduty': return hasPagerDuty;
      case 'opsgenie': return hasOpsGenie;
      case 'email': return hasEmail;
      case 'webhook': return hasWebhooks;
      default: return true;
    }
  };

  if (loading) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">Loading channels...</p>
      </div>
    );
  }

  if (channels.length === 0) {
    return (
      <div className="rounded-lg border border-border-subtle bg-surface-2 p-4">
        <p className="text-sm text-muted-foreground">
          No notification channels configured. Create one in the Channels tab first.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-foreground">Notification Channels</label>
      <div className="space-y-1.5">
        {channels.map((channel) => {
          const meta: ChannelMeta = CHANNEL_TYPE_META[channel.channel_type] || {
            icon: <Bell className="h-4 w-4" />,
            label: channel.channel_type,
          };
          const isSelected = selectedChannels.includes(channel.id);
          const available = isFeatureAvailable(channel.channel_type);

          return (
            <button
              key={channel.id}
              type="button"
              onClick={() => available && toggleChannel(channel.id)}
              disabled={!available}
              className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                isSelected
                  ? 'border-accent-2 bg-accent-2/5 text-foreground'
                  : 'border-border-subtle bg-surface-2 text-muted-foreground hover:border-border-strong hover:text-foreground'
              } ${!available ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
            >
              <span className={isSelected ? 'text-accent-2' : 'text-muted-foreground'}>
                {meta.icon}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">{channel.name}</span>
                  <span className="text-xs text-muted-foreground capitalize">{meta.label}</span>
                  {meta.feature && !available && (
                    <ProBadge feature={meta.feature} size="sm" />
                  )}
                </div>
              </div>
              {isSelected && (
                <Check className="h-4 w-4 text-accent-2 flex-shrink-0" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
