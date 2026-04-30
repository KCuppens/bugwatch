'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { logAlertRulesApi, type LogAlertRule } from '@/lib/api';
import { toast } from 'sonner';
import { Plus, Trash2, Power, Loader2, Bell } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AlertRulesModalProps {
  projectId: string;
  isOpen: boolean;
  onClose: () => void;
}

const EMPTY_FORM: Omit<LogAlertRule, 'id' | 'created_at' | 'last_fired_at'> = {
  name: '',
  level_filter: '',
  search_filter: '',
  threshold: 10,
  window_seconds: 300,
  notification_type: 'email',
  notification_target: '',
  is_active: true,
};

function RuleForm({
  onSave,
  onCancel,
  isSaving,
}: {
  onSave: (rule: Omit<LogAlertRule, 'id' | 'created_at' | 'last_fired_at'>) => void;
  onCancel: () => void;
  isSaving: boolean;
}) {
  const [form, setForm] = useState(EMPTY_FORM);

  function update<K extends keyof typeof EMPTY_FORM>(key: K, value: (typeof EMPTY_FORM)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit() {
    if (!form.name.trim()) {
      toast.error('Rule name is required');
      return;
    }
    if (!form.notification_target.trim()) {
      toast.error('Notification target is required');
      return;
    }
    onSave(form);
  }

  return (
    <div className="space-y-3 rounded-lg border border-border-subtle p-4 bg-black/5">
      <p className="text-sm font-medium">New Alert Rule</p>

      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 space-y-1">
          <Label className="text-xs">Rule Name</Label>
          <Input
            className="h-7 text-xs"
            placeholder="High error rate"
            value={form.name}
            onChange={(e) => update('name', e.target.value)}
          />
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Level Filter</Label>
          <Select
            value={form.level_filter ?? ''}
            onValueChange={(v) => update('level_filter', v === 'any' ? '' : v)}
          >
            <SelectTrigger className="h-7 text-xs">
              <SelectValue placeholder="Any level" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any level</SelectItem>
              <SelectItem value="trace">trace</SelectItem>
              <SelectItem value="debug">debug</SelectItem>
              <SelectItem value="info">info</SelectItem>
              <SelectItem value="warn">warn</SelectItem>
              <SelectItem value="error">error</SelectItem>
              <SelectItem value="fatal">fatal</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Search Filter</Label>
          <Input
            className="h-7 text-xs"
            placeholder="Optional text filter"
            value={form.search_filter ?? ''}
            onChange={(e) => update('search_filter', e.target.value)}
          />
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Threshold (count)</Label>
          <Input
            className="h-7 text-xs"
            type="number"
            min={1}
            value={form.threshold}
            onChange={(e) => update('threshold', Number(e.target.value))}
          />
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Window (seconds)</Label>
          <Input
            className="h-7 text-xs"
            type="number"
            min={60}
            value={form.window_seconds}
            onChange={(e) => update('window_seconds', Number(e.target.value))}
          />
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Notification Type</Label>
          <Select
            value={form.notification_type}
            onValueChange={(v) => update('notification_type', v as 'email' | 'webhook')}
          >
            <SelectTrigger className="h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="email">Email</SelectItem>
              <SelectItem value="webhook">Webhook</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">
            {form.notification_type === 'email' ? 'Email Address' : 'Webhook URL'}
          </Label>
          <Input
            className="h-7 text-xs"
            placeholder={form.notification_type === 'email' ? 'you@example.com' : 'https://...'}
            value={form.notification_target}
            onChange={(e) => update('notification_target', e.target.value)}
          />
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" className="h-7 text-xs" onClick={handleSubmit} disabled={isSaving}>
          {isSaving ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
          Save Rule
        </Button>
      </div>
    </div>
  );
}

export function AlertRulesModal({ projectId, isOpen, onClose }: AlertRulesModalProps) {
  const [showForm, setShowForm] = useState(false);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['log-alert-rules', projectId],
    queryFn: () => logAlertRulesApi.list(projectId),
    staleTime: 30_000,
    enabled: isOpen && !!projectId,
  });

  const createMutation = useMutation({
    mutationFn: (rule: Omit<LogAlertRule, 'id' | 'created_at' | 'last_fired_at'>) =>
      logAlertRulesApi.create(projectId, rule),
    onSuccess: () => {
      toast.success('Alert rule created');
      setShowForm(false);
      void queryClient.invalidateQueries({ queryKey: ['log-alert-rules', projectId] });
    },
    onError: () => {
      toast.error('Failed to create alert rule');
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ ruleId, isActive }: { ruleId: string; isActive: boolean }) =>
      logAlertRulesApi.update(projectId, ruleId, { is_active: isActive }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['log-alert-rules', projectId] });
    },
    onError: () => {
      toast.error('Failed to update rule');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (ruleId: string) => logAlertRulesApi.delete(projectId, ruleId),
    onSuccess: () => {
      toast.success('Rule deleted');
      void queryClient.invalidateQueries({ queryKey: ['log-alert-rules', projectId] });
    },
    onError: () => {
      toast.error('Failed to delete rule');
    },
  });

  const rules = data?.data ?? [];

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            Log Alert Rules
          </DialogTitle>
          <DialogDescription>
            Get notified when log volume exceeds a threshold within a time window.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Existing rules */}
          {isLoading ? (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading rules...
            </div>
          ) : rules.length === 0 && !showForm ? (
            <p className="text-sm text-muted-foreground py-2">
              No alert rules yet. Create one to get notified about log spikes.
            </p>
          ) : (
            <ul className="space-y-2">
              {rules.map((rule) => (
                <li
                  key={rule.id}
                  className={cn(
                    'flex items-center justify-between p-3 rounded-lg border border-border-subtle',
                    !rule.is_active && 'opacity-60'
                  )}
                >
                  <div className="space-y-0.5 min-w-0">
                    <p className="text-sm font-medium truncate">{rule.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {rule.level_filter ? `[${rule.level_filter}] ` : ''}
                      {rule.threshold} logs / {rule.window_seconds}s &middot;{' '}
                      {rule.notification_type}: {rule.notification_target}
                    </p>
                    {rule.last_fired_at && (
                      <p className="text-xs text-amber-500">
                        Last fired: {new Date(rule.last_fired_at).toLocaleString()}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 ml-3">
                    <Button
                      size="sm"
                      variant="ghost"
                      className={cn('h-7 w-7 p-0', rule.is_active ? 'text-green-400' : 'text-muted-foreground')}
                      title={rule.is_active ? 'Disable rule' : 'Enable rule'}
                      onClick={() =>
                        toggleMutation.mutate({ ruleId: rule.id, isActive: !rule.is_active })
                      }
                      disabled={toggleMutation.isPending}
                    >
                      <Power className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-red-400"
                      title="Delete rule"
                      onClick={() => {
                        if (confirm(`Delete rule "${rule.name}"?`)) {
                          deleteMutation.mutate(rule.id);
                        }
                      }}
                      disabled={deleteMutation.isPending}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {/* New rule form */}
          {showForm ? (
            <RuleForm
              onSave={(rule) => createMutation.mutate(rule)}
              onCancel={() => setShowForm(false)}
              isSaving={createMutation.isPending}
            />
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => setShowForm(true)}
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              New Rule
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
