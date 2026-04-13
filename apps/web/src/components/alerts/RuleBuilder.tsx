'use client';

import { useState } from 'react';
import { Save, TestTube2, Loader2 } from 'lucide-react';
import { AlertCondition, alertsApi } from '@/lib/api';
import { toast } from 'sonner';
import { ConditionGroup } from './ConditionGroup';
import { ChannelSelector } from './ChannelSelector';

interface RuleBuilderProps {
  projectId: string;
  initialName?: string;
  initialCondition?: AlertCondition;
  initialChannelIds?: string[];
  ruleId?: string;
  onSave?: () => void;
  onCancel?: () => void;
}

export function RuleBuilder({
  projectId,
  initialName = '',
  initialCondition,
  initialChannelIds = [],
  ruleId,
  onSave,
  onCancel,
}: RuleBuilderProps) {
  const [name, setName] = useState(initialName);
  const [conditions, setConditions] = useState<AlertCondition[]>(
    initialCondition ? [initialCondition] : [{ type: 'new_issue' }]
  );
  const [operator, setOperator] = useState<'AND' | 'OR'>('AND');
  const [channelIds, setChannelIds] = useState<string[]>(initialChannelIds);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error('Please enter a rule name');
      return;
    }
    if (channelIds.length === 0) {
      toast.error('Please select at least one notification channel');
      return;
    }

    // Use the first condition (primary condition for the rule)
    const condition = conditions[0];
    if (!condition) {
      toast.error('Please add at least one condition');
      return;
    }

    setSaving(true);
    try {
      if (ruleId) {
        await alertsApi.updateRule(projectId, ruleId, {
          name: name.trim(),
          condition,
          channel_ids: channelIds,
        });
        toast.success('Alert rule updated');
      } else {
        await alertsApi.createRule(projectId, {
          name: name.trim(),
          condition,
          channel_ids: channelIds,
        });
        toast.success('Alert rule created');
      }
      onSave?.();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to save alert rule';
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!ruleId) {
      toast.error('Save the rule first before testing');
      return;
    }

    setTesting(true);
    try {
      const result = await alertsApi.testRule(projectId, ruleId);
      toast.success(result.message || 'Test notification sent');
    } catch {
      toast.error('Failed to send test notification');
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Rule Name */}
      <div>
        <label className="text-sm font-medium text-foreground mb-1 block">Rule Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Critical error alert"
          className="w-full rounded-lg border border-border-subtle bg-surface-2 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-accent-2 focus:outline-none"
        />
      </div>

      {/* Conditions */}
      <ConditionGroup
        conditions={conditions}
        onChange={setConditions}
        operator={operator}
        onOperatorChange={setOperator}
      />

      {/* Channel Selector */}
      <ChannelSelector
        selectedChannels={channelIds}
        onSelect={setChannelIds}
        projectId={projectId}
      />

      {/* Actions */}
      <div className="flex items-center gap-2 pt-2 border-t border-border-subtle">
        {ruleId && (
          <button
            onClick={handleTest}
            disabled={testing}
            className="flex items-center gap-1.5 rounded-lg border border-border-subtle bg-surface-2 px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-surface-3 hover:text-foreground transition-colors disabled:opacity-50"
          >
            {testing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <TestTube2 className="h-4 w-4" />
            )}
            Test Rule
          </button>
        )}

        <div className="flex-1" />

        {onCancel && (
          <button
            onClick={onCancel}
            className="rounded-lg border border-border-subtle bg-surface-2 px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-surface-3 hover:text-foreground transition-colors"
          >
            Cancel
          </button>
        )}

        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90 transition-colors disabled:opacity-50"
        >
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          {ruleId ? 'Update Rule' : 'Create Rule'}
        </button>
      </div>
    </div>
  );
}
