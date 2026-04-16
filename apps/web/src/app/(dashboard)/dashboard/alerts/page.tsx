"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { toast } from "sonner";
import {
  Bell,
  Plus,
  Mail,
  Globe,
  MessageSquare,
  Loader2,
  Trash2,
  Power,
  Send,
  CheckCircle,
  XCircle,
  Clock,
  Pencil,
} from "lucide-react";
import { alertsApi, type AlertRule, type NotificationChannel, type AlertLog, type AlertCondition } from "@/lib/api";
import { useProject } from "@/lib/project-context";
import { useFeature } from "@/hooks/use-feature";
import { ProBadge, UpgradeLink } from "@/components/pro-badge";
import { formatRelativeTime } from "@/lib/format";

function getConditionDescription(condition: AlertCondition): string {
  switch (condition.type) {
    case "new_issue":
      return condition.level
        ? `Alert when a new ${condition.level}-level issue is detected`
        : "Alert when a new issue is detected";
    case "issue_frequency":
      return `Alert when issues exceed ${condition.threshold} in ${condition.window_minutes} minutes`;
    case "monitor_down":
      return condition.monitor_id
        ? "Alert when a specific uptime monitor goes down"
        : "Alert when any uptime monitor goes down";
    case "monitor_recovery":
      return condition.monitor_id ? "Alert when a specific monitor recovers" : "Alert when any monitor recovers";
    case "server_cpu_high":
      return `Alert when CPU usage exceeds ${condition.threshold_percent}%`;
    case "server_memory_high":
      return `Alert when memory usage exceeds ${condition.threshold_percent}%`;
    case "server_disk_high":
      return `Alert when disk usage exceeds ${condition.threshold_percent}%${condition.mount ? ` on ${condition.mount}` : ""}`;
    case "server_offline":
      return `Alert when a server is offline for more than ${condition.missing_minutes || 5} minutes`;
    default:
      return "Unknown condition";
  }
}

function SkeletonCard() {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Skeleton className="h-8 w-8 rounded-full" />
            <div className="space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-56" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-8 w-8 rounded" />
            <Skeleton className="h-8 w-8 rounded" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function AlertsPage() {
  const { selectedProject } = useProject();

  // Feature gates
  const canUseWebhooks = useFeature("webhooks");

  const [rules, setRules] = useState<AlertRule[]>([]);
  const [channels, setChannels] = useState<NotificationChannel[]>([]);
  const [logs, setLogs] = useState<AlertLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Dialog states for rules
  const [showRuleDialog, setShowRuleDialog] = useState(false);
  const [editingRule, setEditingRule] = useState<AlertRule | null>(null);

  // Dialog states for channels
  const [showChannelDialog, setShowChannelDialog] = useState(false);
  const [editingChannel, setEditingChannel] = useState<NotificationChannel | null>(null);

  // Confirm delete dialog states
  const [deleteRuleTarget, setDeleteRuleTarget] = useState<AlertRule | null>(null);
  const [deleteChannelTarget, setDeleteChannelTarget] = useState<NotificationChannel | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Form states
  const defaultRuleForm = {
    name: "",
    conditionType: "new_issue" as AlertCondition["type"],
    level: "",
    channelIds: [] as string[],
    threshold: 90,
    mount: "",
    missingMinutes: 5,
  };
  const defaultChannelForm = {
    name: "",
    type: "email" as "email" | "webhook" | "slack",
    emails: "",
    webhookUrl: "",
    slackUrl: "",
  };

  const [ruleForm, setRuleForm] = useState(defaultRuleForm);
  const [channelForm, setChannelForm] = useState(defaultChannelForm);
  const [slackTemplate, setSlackTemplate] = useState({
    blocks: [
      { block_type: "header", enabled: true },
      { block_type: "message", enabled: true },
      { block_type: "context", enabled: true },
      { block_type: "stats", enabled: false },
    ],
    actions: [{ action_type: "view_issue", label: "View in Bugwatch", style: "primary" }],
  });
  const [isSaving, setIsSaving] = useState(false);

  // Open create rule dialog
  function openCreateRule() {
    setEditingRule(null);
    setRuleForm(defaultRuleForm);
    setShowRuleDialog(true);
  }

  // Open edit rule dialog
  function openEditRule(rule: AlertRule) {
    setEditingRule(rule);
    const cond = rule.condition;
    setRuleForm({
      name: rule.name,
      conditionType: cond.type,
      level: cond.type === "new_issue" ? cond.level || "" : "",
      channelIds: [...rule.channel_ids],
      threshold:
        cond.type === "server_cpu_high" || cond.type === "server_memory_high" || cond.type === "server_disk_high"
          ? cond.threshold_percent
          : 90,
      mount: cond.type === "server_disk_high" ? cond.mount || "" : "",
      missingMinutes: cond.type === "server_offline" ? cond.missing_minutes || 5 : 5,
    });
    setShowRuleDialog(true);
  }

  // Open create channel dialog
  function openCreateChannel() {
    setEditingChannel(null);
    setChannelForm(defaultChannelForm);
    setSlackTemplate({
      blocks: [
        { block_type: "header", enabled: true },
        { block_type: "message", enabled: true },
        { block_type: "context", enabled: true },
        { block_type: "stats", enabled: false },
      ],
      actions: [{ action_type: "view_issue", label: "View in Bugwatch", style: "primary" }],
    });
    setShowChannelDialog(true);
  }

  // Open edit channel dialog
  function openEditChannel(channel: NotificationChannel) {
    // The edit dialog UI only renders inputs for email/webhook/slack; other
    // channel types (pagerduty, opsgenie) are created via their dedicated flows.
    if (channel.channel_type !== "email" && channel.channel_type !== "webhook" && channel.channel_type !== "slack") {
      return;
    }

    setEditingChannel(channel);
    const cfg = channel.config;
    let emails = "";
    let webhookUrl = "";
    let slackUrl = "";

    if (channel.channel_type === "email" && "recipients" in cfg) {
      emails = cfg.recipients.join(", ");
    } else if (channel.channel_type === "webhook" && "url" in cfg) {
      webhookUrl = cfg.url;
    } else if (channel.channel_type === "slack" && "webhook_url" in cfg) {
      slackUrl = cfg.webhook_url;
      if (cfg.message_template) {
        setSlackTemplate(cfg.message_template);
      }
    }

    setChannelForm({
      name: channel.name,
      type: channel.channel_type,
      emails,
      webhookUrl,
      slackUrl,
    });
    setShowChannelDialog(true);
  }

  const fetchData = useCallback(async () => {
    if (!selectedProject) {
      setRules([]);
      setChannels([]);
      setLogs([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const [rulesRes, channelsRes, logsRes] = await Promise.all([
        alertsApi.listRules(selectedProject.id),
        alertsApi.listChannels(selectedProject.id),
        alertsApi.listLogs(selectedProject.id),
      ]);
      setRules(rulesRes);
      setChannels(channelsRes);
      setLogs(logsRes);
    } catch {
      toast.error("Failed to load alerts data");
    } finally {
      setIsLoading(false);
    }
  }, [selectedProject]);

  // Fetch data when selected project changes
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  function buildCondition(): AlertCondition {
    switch (ruleForm.conditionType) {
      case "new_issue":
        return { type: "new_issue", level: ruleForm.level || undefined };
      case "monitor_down":
        return { type: "monitor_down" };
      case "monitor_recovery":
        return { type: "monitor_recovery" };
      case "server_cpu_high":
        return { type: "server_cpu_high", threshold_percent: ruleForm.threshold };
      case "server_memory_high":
        return { type: "server_memory_high", threshold_percent: ruleForm.threshold };
      case "server_disk_high":
        return { type: "server_disk_high", threshold_percent: ruleForm.threshold, mount: ruleForm.mount || undefined };
      case "server_offline":
        return { type: "server_offline", missing_minutes: ruleForm.missingMinutes };
      default:
        return { type: "new_issue" };
    }
  }

  async function handleSaveRule() {
    if (!selectedProject || !ruleForm.name || ruleForm.channelIds.length === 0) return;

    setIsSaving(true);
    try {
      const condition = buildCondition();
      const payload = {
        name: ruleForm.name,
        condition,
        channel_ids: ruleForm.channelIds,
      };

      if (editingRule) {
        const response = await alertsApi.updateRule(selectedProject.id, editingRule.id, payload);
        setRules(rules.map((r) => (r.id === editingRule.id ? response : r)));
        toast.success("Alert rule updated successfully");
      } else {
        const response = await alertsApi.createRule(selectedProject.id, payload);
        setRules([response, ...rules]);
        toast.success("Alert rule created successfully");
      }
      setShowRuleDialog(false);
      setRuleForm(defaultRuleForm);
      setEditingRule(null);
    } catch {
      toast.error(editingRule ? "Failed to update alert rule" : "Failed to create alert rule");
    } finally {
      setIsSaving(false);
    }
  }

  function buildChannelConfig() {
    switch (channelForm.type) {
      case "email":
        return { recipients: channelForm.emails.split(",").map((e) => e.trim()) };
      case "webhook":
        return { url: channelForm.webhookUrl };
      case "slack":
        return {
          webhook_url: channelForm.slackUrl,
          message_template: slackTemplate,
        };
    }
  }

  async function handleSaveChannel() {
    if (!selectedProject || !channelForm.name) return;

    setIsSaving(true);
    try {
      const config = buildChannelConfig();
      const payload = {
        name: channelForm.name,
        channel_type: channelForm.type,
        config,
      };

      if (editingChannel) {
        const response = await alertsApi.updateChannel(selectedProject.id, editingChannel.id, payload);
        setChannels(channels.map((c) => (c.id === editingChannel.id ? response : c)));
        toast.success("Notification channel updated successfully");
      } else {
        const response = await alertsApi.createChannel(selectedProject.id, payload);
        setChannels([response, ...channels]);
        toast.success("Notification channel created successfully");
      }
      setShowChannelDialog(false);
      setChannelForm(defaultChannelForm);
      setEditingChannel(null);
    } catch {
      toast.error(editingChannel ? "Failed to update channel" : "Failed to create channel");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleToggleRule(rule: AlertRule) {
    if (!selectedProject) return;
    try {
      const response = await alertsApi.updateRule(selectedProject.id, rule.id, {
        is_active: !rule.is_active,
      });
      setRules(rules.map((r) => (r.id === rule.id ? response : r)));
      toast.success(response.is_active ? "Alert rule enabled" : "Alert rule paused");
    } catch {
      toast.error("Failed to toggle alert rule");
    }
  }

  async function handleDeleteRule() {
    if (!selectedProject || !deleteRuleTarget) return;
    setIsDeleting(true);
    try {
      await alertsApi.deleteRule(selectedProject.id, deleteRuleTarget.id);
      setRules(rules.filter((r) => r.id !== deleteRuleTarget.id));
      toast.success("Alert rule deleted");
      setDeleteRuleTarget(null);
    } catch {
      toast.error("Failed to delete alert rule");
    } finally {
      setIsDeleting(false);
    }
  }

  async function handleToggleChannel(channel: NotificationChannel) {
    if (!selectedProject) return;
    try {
      const response = await alertsApi.updateChannel(selectedProject.id, channel.id, {
        is_active: !channel.is_active,
      });
      setChannels(channels.map((c) => (c.id === channel.id ? response : c)));
      toast.success(response.is_active ? "Channel enabled" : "Channel disabled");
    } catch {
      toast.error("Failed to toggle channel");
    }
  }

  async function handleDeleteChannel() {
    if (!selectedProject || !deleteChannelTarget) return;
    setIsDeleting(true);
    try {
      await alertsApi.deleteChannel(selectedProject.id, deleteChannelTarget.id);
      setChannels(channels.filter((c) => c.id !== deleteChannelTarget.id));
      toast.success("Notification channel deleted");
      setDeleteChannelTarget(null);
    } catch {
      toast.error("Failed to delete channel");
    } finally {
      setIsDeleting(false);
    }
  }

  async function handleTestChannel(channelId: string) {
    if (!selectedProject) return;
    try {
      await alertsApi.testChannel(selectedProject.id, channelId);
      toast.success("Test notification sent!");
    } catch {
      toast.error("Failed to send test notification");
    }
  }

  const getChannelIcon = (type: string) => {
    switch (type) {
      case "email":
        return <Mail className="h-4 w-4" />;
      case "webhook":
        return <Globe className="h-4 w-4" />;
      case "slack":
        return <MessageSquare className="h-4 w-4" />;
      default:
        return <Bell className="h-4 w-4" />;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-heading-lg">Alerts</h1>
          <p className="text-body-sm text-muted-foreground mt-1">Configure alert rules and notification channels</p>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="rules">
        <TabsList>
          <TabsTrigger value="rules">Alert Rules</TabsTrigger>
          <TabsTrigger value="channels">Channels</TabsTrigger>
          <TabsTrigger value="logs">Activity Log</TabsTrigger>
        </TabsList>

        {isLoading ? (
          <div className="mt-4 space-y-4">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : (
          <>
            {/* Alert Rules Tab */}
            <TabsContent value="rules">
              <div className="space-y-4">
                <div className="flex justify-end">
                  <Button
                    variant="success"
                    onClick={openCreateRule}
                    disabled={!selectedProject || channels.length === 0}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Create Alert Rule
                  </Button>
                </div>

                {channels.length === 0 && (
                  <Card>
                    <CardContent className="py-8 text-center text-muted-foreground">
                      Create a notification channel first before creating alert rules.
                    </CardContent>
                  </Card>
                )}

                {rules.length === 0 && channels.length > 0 ? (
                  <Card>
                    <CardContent className="p-0">
                      <EmptyState
                        icon={<Bell />}
                        title="No alert rules"
                        description="Create alert rules to get notified about issues and monitor events."
                      />
                    </CardContent>
                  </Card>
                ) : (
                  rules.map((rule) => (
                    <Card key={rule.id}>
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-4">
                            <div
                              className={`rounded-full p-2 ${rule.is_active ? "bg-bug/10" : "bg-gray-100 dark:bg-gray-800"}`}
                            >
                              <Bell className={`h-4 w-4 ${rule.is_active ? "text-bug" : "text-gray-500"}`} />
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <h3 className="font-medium">{rule.name}</h3>
                                {!rule.is_active && (
                                  <span className="text-xs bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300 px-2 py-0.5 rounded">
                                    Paused
                                  </span>
                                )}
                              </div>
                              <p className="text-sm text-muted-foreground">{getConditionDescription(rule.condition)}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-muted-foreground">
                              {rule.channel_ids.length} channel{rule.channel_ids.length !== 1 ? "s" : ""}
                            </span>
                            <Button variant="ghost" size="icon" aria-label={`Edit rule: ${rule.name}`} onClick={() => openEditRule(rule)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" aria-label={`${rule.is_active ? 'Disable' : 'Enable'} rule: ${rule.name}`} onClick={() => handleToggleRule(rule)}>
                              <Power className={`h-4 w-4 ${rule.is_active ? "text-bug" : ""}`} />
                            </Button>
                            <Button variant="ghost" size="icon" aria-label={`Delete rule: ${rule.name}`} onClick={() => setDeleteRuleTarget(rule)}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))
                )}
              </div>
            </TabsContent>

            {/* Channels Tab */}
            <TabsContent value="channels">
              <div className="space-y-4">
                <div className="flex justify-end">
                  <Button variant="success" onClick={openCreateChannel} disabled={!selectedProject}>
                    <Plus className="mr-2 h-4 w-4" />
                    Add Channel
                  </Button>
                </div>

                {channels.length === 0 ? (
                  <Card>
                    <CardContent className="p-0">
                      <EmptyState
                        icon={<Mail />}
                        title="No notification channels"
                        description="Add email, webhook, or Slack channels to receive alerts."
                      />
                    </CardContent>
                  </Card>
                ) : (
                  channels.map((channel) => (
                    <Card key={channel.id}>
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-4">
                            <div
                              className={`rounded-full p-2 ${channel.is_active ? "bg-accent-2/10" : "bg-gray-100 dark:bg-gray-800"}`}
                            >
                              {getChannelIcon(channel.channel_type)}
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <h3 className="font-medium">{channel.name}</h3>
                                <span className="text-xs bg-muted px-2 py-0.5 rounded capitalize">
                                  {channel.channel_type}
                                </span>
                                {!channel.is_active && (
                                  <span className="text-xs bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300 px-2 py-0.5 rounded">
                                    Disabled
                                  </span>
                                )}
                              </div>
                              <p className="text-sm text-muted-foreground">
                                Created {formatRelativeTime(channel.created_at)}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button variant="outline" size="sm" onClick={() => handleTestChannel(channel.id)}>
                              <Send className="mr-2 h-3 w-3" />
                              Test
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => openEditChannel(channel)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => handleToggleChannel(channel)}>
                              <Power className={`h-4 w-4 ${channel.is_active ? "text-bug" : ""}`} />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => setDeleteChannelTarget(channel)}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))
                )}
              </div>
            </TabsContent>

            {/* Logs Tab */}
            <TabsContent value="logs">
              <div className="space-y-4">
                {logs.length === 0 ? (
                  <Card>
                    <CardContent className="p-0">
                      <EmptyState
                        icon={<Clock />}
                        title="No alert activity"
                        description="Alert notifications will appear here when they are triggered."
                      />
                    </CardContent>
                  </Card>
                ) : (
                  logs.map((log) => (
                    <Card key={log.id}>
                      <CardContent className="p-4">
                        <div className="flex items-center gap-4">
                          <div
                            className={`rounded-full p-2 ${
                              log.status === "sent"
                                ? "bg-bug/10"
                                : log.status === "failed"
                                  ? "bg-red-100 dark:bg-red-950"
                                  : "bg-yellow-100 dark:bg-yellow-950"
                            }`}
                          >
                            {log.status === "sent" ? (
                              <CheckCircle className="h-4 w-4 text-bug" />
                            ) : log.status === "failed" ? (
                              <XCircle className="h-4 w-4 text-red-500" />
                            ) : (
                              <Clock className="h-4 w-4 text-yellow-500" />
                            )}
                          </div>
                          <div className="flex-1">
                            <p className="text-sm">{log.message}</p>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-xs text-muted-foreground capitalize">{log.trigger_type}</span>
                              <span className="text-xs text-muted-foreground">
                                {formatRelativeTime(log.created_at)}
                              </span>
                              {log.error_message && (
                                <span className="text-xs text-destructive">{log.error_message}</span>
                              )}
                            </div>
                          </div>
                          <span
                            className={`text-xs px-2 py-1 rounded ${
                              log.status === "sent"
                                ? "bg-bug text-bug-foreground"
                                : log.status === "failed"
                                  ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
                                  : "bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300"
                            }`}
                          >
                            {log.status}
                          </span>
                        </div>
                      </CardContent>
                    </Card>
                  ))
                )}
              </div>
            </TabsContent>
          </>
        )}
      </Tabs>

      {/* Rule Dialog (Create / Edit) */}
      <Dialog
        open={showRuleDialog}
        onOpenChange={(open) => {
          if (!open) {
            setShowRuleDialog(false);
            setEditingRule(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingRule ? "Edit Alert Rule" : "Create Alert Rule"}</DialogTitle>
            <DialogDescription>
              {editingRule
                ? "Update the alert rule configuration below."
                : "Configure a new alert rule to get notified about events."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ruleName">Name</Label>
              <Input
                id="ruleName"
                placeholder="New errors alert"
                value={ruleForm.name}
                onChange={(e) => setRuleForm({ ...ruleForm, name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Condition</Label>
              <Select
                value={ruleForm.conditionType}
                onValueChange={(v) => setRuleForm({ ...ruleForm, conditionType: v as AlertCondition["type"] })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="new_issue">New Issue</SelectItem>
                  <SelectItem value="monitor_down">Monitor Down</SelectItem>
                  <SelectItem value="monitor_recovery">Monitor Recovery</SelectItem>
                  <SelectItem value="server_cpu_high">Server CPU High</SelectItem>
                  <SelectItem value="server_memory_high">Server Memory High</SelectItem>
                  <SelectItem value="server_disk_high">Server Disk High</SelectItem>
                  <SelectItem value="server_offline">Server Offline</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {(ruleForm.conditionType === "server_cpu_high" ||
              ruleForm.conditionType === "server_memory_high" ||
              ruleForm.conditionType === "server_disk_high") && (
              <div className="space-y-2">
                <Label>Threshold (%)</Label>
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={ruleForm.threshold}
                  onChange={(e) => setRuleForm({ ...ruleForm, threshold: Number(e.target.value) })}
                />
              </div>
            )}
            {ruleForm.conditionType === "server_disk_high" && (
              <div className="space-y-2">
                <Label>Mount Point (optional)</Label>
                <Input
                  placeholder="/ (leave empty for any)"
                  value={ruleForm.mount}
                  onChange={(e) => setRuleForm({ ...ruleForm, mount: e.target.value })}
                />
              </div>
            )}
            {ruleForm.conditionType === "server_offline" && (
              <div className="space-y-2">
                <Label>Missing Duration (minutes)</Label>
                <Input
                  type="number"
                  min={1}
                  value={ruleForm.missingMinutes}
                  onChange={(e) => setRuleForm({ ...ruleForm, missingMinutes: Number(e.target.value) })}
                />
              </div>
            )}
            {ruleForm.conditionType === "new_issue" && (
              <div className="space-y-2">
                <Label>Issue Level (optional)</Label>
                <Select
                  value={ruleForm.level || "all"}
                  onValueChange={(v) => setRuleForm({ ...ruleForm, level: v === "all" ? "" : v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All levels</SelectItem>
                    <SelectItem value="error">Error only</SelectItem>
                    <SelectItem value="fatal">Fatal only</SelectItem>
                    <SelectItem value="warning">Warning only</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-2">
              <Label>Notification Channels</Label>
              <div className="space-y-2">
                {channels.map((channel) => (
                  <label key={channel.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={ruleForm.channelIds.includes(channel.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setRuleForm({ ...ruleForm, channelIds: [...ruleForm.channelIds, channel.id] });
                        } else {
                          setRuleForm({
                            ...ruleForm,
                            channelIds: ruleForm.channelIds.filter((id) => id !== channel.id),
                          });
                        }
                      }}
                      className="h-4 w-4 rounded border-border text-accent-2 focus:ring-accent-2 focus:ring-offset-background"
                    />
                    <span className="text-sm">{channel.name}</span>
                    <span className="text-xs text-muted-foreground capitalize">({channel.channel_type})</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => {
                setShowRuleDialog(false);
                setEditingRule(null);
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleSaveRule} disabled={isSaving || !ruleForm.name || ruleForm.channelIds.length === 0}>
              {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editingRule ? "Save Changes" : "Create Rule"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Channel Dialog (Create / Edit) */}
      <Dialog
        open={showChannelDialog}
        onOpenChange={(open) => {
          if (!open) {
            setShowChannelDialog(false);
            setEditingChannel(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingChannel ? "Edit Notification Channel" : "Add Notification Channel"}</DialogTitle>
            <DialogDescription>
              {editingChannel
                ? "Update the notification channel configuration below."
                : "Add a new notification channel to receive alerts."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="channelName">Name</Label>
              <Input
                id="channelName"
                placeholder="Team email"
                value={channelForm.name}
                onChange={(e) => setChannelForm({ ...channelForm, name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Type</Label>
              <Select
                value={channelForm.type}
                onValueChange={(v) => setChannelForm({ ...channelForm, type: v as "email" | "webhook" | "slack" })}
                disabled={!!editingChannel}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="webhook" disabled={!canUseWebhooks}>
                    <div className="flex items-center gap-2">
                      <span>Webhook</span>
                      {!canUseWebhooks && <ProBadge feature="webhooks" showLabel={false} />}
                    </div>
                  </SelectItem>
                  <SelectItem value="slack" disabled={!canUseWebhooks}>
                    <div className="flex items-center gap-2">
                      <span>Slack</span>
                      {!canUseWebhooks && <ProBadge feature="slack" showLabel={false} />}
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
              {!canUseWebhooks && (
                <p className="text-xs text-muted-foreground">
                  Webhook and Slack channels require Pro plan. <UpgradeLink feature="webhooks">Upgrade now</UpgradeLink>
                </p>
              )}
            </div>
            {channelForm.type === "email" && (
              <div className="space-y-2">
                <Label htmlFor="emails">Recipients (comma-separated)</Label>
                <Input
                  id="emails"
                  placeholder="team@example.com, alerts@example.com"
                  value={channelForm.emails}
                  onChange={(e) => setChannelForm({ ...channelForm, emails: e.target.value })}
                />
              </div>
            )}
            {channelForm.type === "webhook" && (
              <div className="space-y-2">
                <Label htmlFor="webhookUrl">Webhook URL</Label>
                <Input
                  id="webhookUrl"
                  placeholder="https://api.example.com/webhook"
                  value={channelForm.webhookUrl}
                  onChange={(e) => setChannelForm({ ...channelForm, webhookUrl: e.target.value })}
                />
              </div>
            )}
            {channelForm.type === "slack" && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="slackUrl">Slack Webhook URL</Label>
                  <Input
                    id="slackUrl"
                    placeholder="https://hooks.slack.com/services/..."
                    value={channelForm.slackUrl}
                    onChange={(e) => setChannelForm({ ...channelForm, slackUrl: e.target.value })}
                  />
                </div>

                {/* Message Template Builder */}
                <div className="space-y-3 pt-3 border-t">
                  <Label>Message Blocks</Label>
                  <p className="text-xs text-muted-foreground">
                    Customize which blocks appear in your Slack notifications.
                  </p>
                  <div className="space-y-2">
                    {slackTemplate.blocks.map((block, index) => (
                      <div key={block.block_type} className="surface-card flex items-center justify-between p-2">
                        <span className="text-sm capitalize">
                          {block.block_type === "header" && "Header (Title with severity)"}
                          {block.block_type === "message" && "Message (Error details)"}
                          {block.block_type === "context" && "Context (Project, severity, time)"}
                          {block.block_type === "stats" && "Stats (Event count, users)"}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            const newBlocks = [...slackTemplate.blocks];
                            newBlocks[index] = { ...block, enabled: !block.enabled };
                            setSlackTemplate({ ...slackTemplate, blocks: newBlocks });
                          }}
                          className={`px-2 py-1 text-xs rounded ${
                            block.enabled ? "bg-accent-2 text-accent-2-foreground" : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {block.enabled ? "On" : "Off"}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="space-y-3 pt-3 border-t">
                  <Label>Action Buttons</Label>
                  <p className="text-xs text-muted-foreground">Add quick action buttons to your Slack messages.</p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const hasViewIssue = slackTemplate.actions.some((a) => a.action_type === "view_issue");
                        if (hasViewIssue) {
                          setSlackTemplate({
                            ...slackTemplate,
                            actions: slackTemplate.actions.filter((a) => a.action_type !== "view_issue"),
                          });
                        } else {
                          setSlackTemplate({
                            ...slackTemplate,
                            actions: [
                              ...slackTemplate.actions,
                              { action_type: "view_issue", label: "View Issue", style: "primary" },
                            ],
                          });
                        }
                      }}
                      className={`px-3 py-1.5 text-xs rounded border ${
                        slackTemplate.actions.some((a) => a.action_type === "view_issue")
                          ? "bg-accent-2 text-accent-2-foreground border-accent-2"
                          : "bg-[hsl(var(--surface-1))] border-muted-foreground/20"
                      }`}
                    >
                      View Issue
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const hasResolve = slackTemplate.actions.some((a) => a.action_type === "resolve");
                        if (hasResolve) {
                          setSlackTemplate({
                            ...slackTemplate,
                            actions: slackTemplate.actions.filter((a) => a.action_type !== "resolve"),
                          });
                        } else {
                          setSlackTemplate({
                            ...slackTemplate,
                            actions: [
                              ...slackTemplate.actions,
                              { action_type: "resolve", label: "Resolve", style: "default" },
                            ],
                          });
                        }
                      }}
                      className={`px-3 py-1.5 text-xs rounded border ${
                        slackTemplate.actions.some((a) => a.action_type === "resolve")
                          ? "bg-green-600 text-white border-green-600"
                          : "bg-[hsl(var(--surface-1))] border-muted-foreground/20"
                      }`}
                    >
                      Resolve
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const hasMute = slackTemplate.actions.some((a) => a.action_type === "mute");
                        if (hasMute) {
                          setSlackTemplate({
                            ...slackTemplate,
                            actions: slackTemplate.actions.filter((a) => a.action_type !== "mute"),
                          });
                        } else {
                          setSlackTemplate({
                            ...slackTemplate,
                            actions: [
                              ...slackTemplate.actions,
                              { action_type: "mute", label: "Mute", style: "default" },
                            ],
                          });
                        }
                      }}
                      className={`px-3 py-1.5 text-xs rounded border ${
                        slackTemplate.actions.some((a) => a.action_type === "mute")
                          ? "bg-orange-600 text-white border-orange-600"
                          : "bg-[hsl(var(--surface-1))] border-muted-foreground/20"
                      }`}
                    >
                      Mute
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => {
                setShowChannelDialog(false);
                setEditingChannel(null);
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveChannel}
              disabled={
                isSaving ||
                !channelForm.name ||
                (channelForm.type === "email" && !channelForm.emails.trim()) ||
                (channelForm.type === "webhook" && !channelForm.webhookUrl.trim()) ||
                (channelForm.type === "slack" && !channelForm.slackUrl.trim())
              }
            >
              {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editingChannel ? "Save Changes" : "Add Channel"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm Delete Rule Dialog */}
      <ConfirmDialog
        open={!!deleteRuleTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteRuleTarget(null);
        }}
        title="Delete Alert Rule"
        description={`Are you sure you want to delete "${deleteRuleTarget?.name}"? This action cannot be undone.`}
        confirmLabel="Delete Rule"
        variant="destructive"
        onConfirm={handleDeleteRule}
        loading={isDeleting}
      />

      {/* Confirm Delete Channel Dialog */}
      <ConfirmDialog
        open={!!deleteChannelTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteChannelTarget(null);
        }}
        title="Delete Notification Channel"
        description={`Are you sure you want to delete "${deleteChannelTarget?.name}"? Any alert rules using this channel will no longer send notifications through it.`}
        confirmLabel="Delete Channel"
        variant="destructive"
        onConfirm={handleDeleteChannel}
        loading={isDeleting}
      />
    </div>
  );
}
