"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
} from "lucide-react";
import {
  alertsApi,
  projectsApi,
  type AlertRule,
  type NotificationChannel,
  type AlertLog,
  type Project,
  type AlertCondition,
} from "@/lib/api";
import { useFeature } from "@/hooks/use-feature";
import { ProBadge, UpgradeLink } from "@/components/pro-badge";

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return date.toLocaleDateString();
}

function getConditionDescription(condition: AlertCondition): string {
  switch (condition.type) {
    case "new_issue":
      return condition.level
        ? `New ${condition.level} issues`
        : "All new issues";
    case "issue_frequency":
      return `${condition.threshold}+ issues in ${condition.window_minutes} min`;
    case "monitor_down":
      return condition.monitor_id
        ? "Specific monitor down"
        : "Any monitor down";
    case "monitor_recovery":
      return condition.monitor_id
        ? "Specific monitor recovery"
        : "Any monitor recovery";
    default:
      return "Unknown condition";
  }
}

export default function AlertsPage() {
  const searchParams = useSearchParams();
  const projectId = searchParams.get("project");

  // Feature gates
  const canUseWebhooks = useFeature("webhooks");

  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<string | null>(projectId);
  const [activeTab, setActiveTab] = useState<"rules" | "channels" | "logs">("rules");

  const [rules, setRules] = useState<AlertRule[]>([]);
  const [channels, setChannels] = useState<NotificationChannel[]>([]);
  const [logs, setLogs] = useState<AlertLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Modal states
  const [showCreateRule, setShowCreateRule] = useState(false);
  const [showCreateChannel, setShowCreateChannel] = useState(false);

  // Form states
  const [newRule, setNewRule] = useState({
    name: "",
    conditionType: "new_issue" as AlertCondition["type"],
    level: "",
    channelIds: [] as string[],
  });
  const [newChannel, setNewChannel] = useState({
    name: "",
    type: "email" as "email" | "webhook" | "slack",
    emails: "",
    webhookUrl: "",
    slackUrl: "",
  });
  const [slackTemplate, setSlackTemplate] = useState({
    blocks: [
      { block_type: "header", enabled: true },
      { block_type: "message", enabled: true },
      { block_type: "context", enabled: true },
      { block_type: "stats", enabled: false },
    ],
    actions: [
      { action_type: "view_issue", label: "View in Bugwatch", style: "primary" },
    ],
  });
  const [isCreating, setIsCreating] = useState(false);

  // Fetch projects
  useEffect(() => {
    async function fetchProjects() {
      try {
        const response = await projectsApi.list();
        setProjects(response.data);
        const firstProject = response.data[0];
        if (!selectedProject && firstProject) {
          setSelectedProject(firstProject.id);
        }
      } catch (err) {
        console.error("Failed to fetch projects:", err);
      }
    }
    fetchProjects();
  }, [selectedProject]);

  // Fetch data when project changes
  useEffect(() => {
    async function fetchData() {
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
          alertsApi.listRules(selectedProject),
          alertsApi.listChannels(selectedProject),
          alertsApi.listLogs(selectedProject),
        ]);
        setRules(rulesRes);
        setChannels(channelsRes);
        setLogs(logsRes);
      } catch (err) {
        console.error("Failed to fetch alerts data:", err);
      } finally {
        setIsLoading(false);
      }
    }
    fetchData();
  }, [selectedProject]);

  async function handleCreateRule() {
    if (!selectedProject || !newRule.name || newRule.channelIds.length === 0) return;

    setIsCreating(true);
    try {
      let condition: AlertCondition;
      switch (newRule.conditionType) {
        case "new_issue":
          condition = { type: "new_issue", level: newRule.level || undefined };
          break;
        case "monitor_down":
          condition = { type: "monitor_down" };
          break;
        case "monitor_recovery":
          condition = { type: "monitor_recovery" };
          break;
        default:
          condition = { type: "new_issue" };
      }

      const response = await alertsApi.createRule(selectedProject, {
        name: newRule.name,
        condition,
        channel_ids: newRule.channelIds,
      });
      setRules([response, ...rules]);
      setShowCreateRule(false);
      setNewRule({ name: "", conditionType: "new_issue", level: "", channelIds: [] });
    } catch (err) {
      console.error("Failed to create rule:", err);
    } finally {
      setIsCreating(false);
    }
  }

  async function handleCreateChannel() {
    if (!selectedProject || !newChannel.name) return;

    setIsCreating(true);
    try {
      let config;
      switch (newChannel.type) {
        case "email":
          config = { recipients: newChannel.emails.split(",").map((e) => e.trim()) };
          break;
        case "webhook":
          config = { url: newChannel.webhookUrl };
          break;
        case "slack":
          config = {
            webhook_url: newChannel.slackUrl,
            message_template: slackTemplate,
          };
          break;
      }

      const response = await alertsApi.createChannel(selectedProject, {
        name: newChannel.name,
        channel_type: newChannel.type,
        config,
      });
      setChannels([response, ...channels]);
      setShowCreateChannel(false);
      setNewChannel({ name: "", type: "email", emails: "", webhookUrl: "", slackUrl: "" });
    } catch (err) {
      console.error("Failed to create channel:", err);
    } finally {
      setIsCreating(false);
    }
  }

  async function handleToggleRule(rule: AlertRule) {
    if (!selectedProject) return;
    try {
      const response = await alertsApi.updateRule(selectedProject, rule.id, {
        is_active: !rule.is_active,
      });
      setRules(rules.map((r) => (r.id === rule.id ? response : r)));
    } catch (err) {
      console.error("Failed to toggle rule:", err);
    }
  }

  async function handleDeleteRule(ruleId: string) {
    if (!selectedProject) return;
    try {
      await alertsApi.deleteRule(selectedProject, ruleId);
      setRules(rules.filter((r) => r.id !== ruleId));
    } catch (err) {
      console.error("Failed to delete rule:", err);
    }
  }

  async function handleToggleChannel(channel: NotificationChannel) {
    if (!selectedProject) return;
    try {
      const response = await alertsApi.updateChannel(selectedProject, channel.id, {
        is_active: !channel.is_active,
      });
      setChannels(channels.map((c) => (c.id === channel.id ? response : c)));
    } catch (err) {
      console.error("Failed to toggle channel:", err);
    }
  }

  async function handleDeleteChannel(channelId: string) {
    if (!selectedProject) return;
    try {
      await alertsApi.deleteChannel(selectedProject, channelId);
      setChannels(channels.filter((c) => c.id !== channelId));
    } catch (err) {
      console.error("Failed to delete channel:", err);
    }
  }

  async function handleTestChannel(channelId: string) {
    if (!selectedProject) return;
    try {
      await alertsApi.testChannel(selectedProject, channelId);
      alert("Test notification sent!");
    } catch (err) {
      console.error("Failed to test channel:", err);
      alert("Failed to send test notification");
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
          <h1 className="text-2xl font-bold">Alerts</h1>
          <p className="text-muted-foreground">
            Configure alert rules and notification channels
          </p>
        </div>
        <div className="flex items-center gap-4">
          {projects.length > 0 && (
            <Select
              value={selectedProject || undefined}
              onValueChange={setSelectedProject}
            >
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Select project" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b">
        <div className="flex gap-4">
          {(["rules", "channels", "logs"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`border-b-2 px-1 pb-3 text-sm font-medium transition-colors ${
                activeTab === tab
                  ? "border-bug text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab === "rules"
                ? "Alert Rules"
                : tab === "channels"
                ? "Channels"
                : "Activity Log"}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {/* Alert Rules Tab */}
          {activeTab === "rules" && (
            <div className="space-y-4">
              <div className="flex justify-end">
                <Button variant="success" onClick={() => setShowCreateRule(true)} disabled={!selectedProject || channels.length === 0}>
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
                  <CardContent className="flex flex-col items-center justify-center py-16">
                    <div className="rounded-full bg-muted p-4">
                      <Bell className="h-8 w-8 text-muted-foreground" />
                    </div>
                    <h3 className="mt-4 text-lg font-medium">No alert rules</h3>
                    <p className="mt-2 text-center text-muted-foreground">
                      Create alert rules to get notified about issues and monitor events.
                    </p>
                  </CardContent>
                </Card>
              ) : (
                rules.map((rule) => (
                  <Card key={rule.id}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className={`rounded-full p-2 ${rule.is_active ? "bg-bug/10" : "bg-gray-100 dark:bg-gray-800"}`}>
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
                            <p className="text-sm text-muted-foreground">
                              {getConditionDescription(rule.condition)}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-muted-foreground">
                            {rule.channel_ids.length} channel{rule.channel_ids.length !== 1 ? "s" : ""}
                          </span>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleToggleRule(rule)}
                          >
                            <Power className={`h-4 w-4 ${rule.is_active ? "text-bug" : ""}`} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDeleteRule(rule.id)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          )}

          {/* Channels Tab */}
          {activeTab === "channels" && (
            <div className="space-y-4">
              <div className="flex justify-end">
                <Button variant="success" onClick={() => setShowCreateChannel(true)} disabled={!selectedProject}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Channel
                </Button>
              </div>

              {channels.length === 0 ? (
                <Card>
                  <CardContent className="flex flex-col items-center justify-center py-16">
                    <div className="rounded-full bg-muted p-4">
                      <Mail className="h-8 w-8 text-muted-foreground" />
                    </div>
                    <h3 className="mt-4 text-lg font-medium">No notification channels</h3>
                    <p className="mt-2 text-center text-muted-foreground">
                      Add email, webhook, or Slack channels to receive alerts.
                    </p>
                  </CardContent>
                </Card>
              ) : (
                channels.map((channel) => (
                  <Card key={channel.id}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className={`rounded-full p-2 ${channel.is_active ? "bg-primary/10" : "bg-gray-100 dark:bg-gray-800"}`}>
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
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleTestChannel(channel.id)}
                          >
                            <Send className="mr-2 h-3 w-3" />
                            Test
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleToggleChannel(channel)}
                          >
                            <Power className={`h-4 w-4 ${channel.is_active ? "text-bug" : ""}`} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDeleteChannel(channel.id)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          )}

          {/* Logs Tab */}
          {activeTab === "logs" && (
            <div className="space-y-4">
              {logs.length === 0 ? (
                <Card>
                  <CardContent className="flex flex-col items-center justify-center py-16">
                    <div className="rounded-full bg-muted p-4">
                      <Clock className="h-8 w-8 text-muted-foreground" />
                    </div>
                    <h3 className="mt-4 text-lg font-medium">No alert activity</h3>
                    <p className="mt-2 text-center text-muted-foreground">
                      Alert notifications will appear here when they are triggered.
                    </p>
                  </CardContent>
                </Card>
              ) : (
                logs.map((log) => (
                  <Card key={log.id}>
                    <CardContent className="p-4">
                      <div className="flex items-center gap-4">
                        <div className={`rounded-full p-2 ${
                          log.status === "sent"
                            ? "bg-bug/10"
                            : log.status === "failed"
                            ? "bg-red-100 dark:bg-red-950"
                            : "bg-yellow-100 dark:bg-yellow-950"
                        }`}>
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
                            <span className="text-xs text-muted-foreground capitalize">
                              {log.trigger_type}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {formatRelativeTime(log.created_at)}
                            </span>
                            {log.error_message && (
                              <span className="text-xs text-destructive">
                                {log.error_message}
                              </span>
                            )}
                          </div>
                        </div>
                        <span className={`text-xs px-2 py-1 rounded ${
                          log.status === "sent"
                            ? "bg-bug text-bug-foreground"
                            : log.status === "failed"
                            ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
                            : "bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300"
                        }`}>
                          {log.status}
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          )}
        </>
      )}

      {/* Create Rule Modal */}
      {showCreateRule && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm">
          <div className="fixed left-[50%] top-[50%] z-50 w-full max-w-md translate-x-[-50%] translate-y-[-50%] border bg-background shadow-lg sm:rounded-lg p-6">
            <h2 className="text-lg font-semibold mb-4">Create Alert Rule</h2>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="ruleName">Name</Label>
                <Input
                  id="ruleName"
                  placeholder="New errors alert"
                  value={newRule.name}
                  onChange={(e) => setNewRule({ ...newRule, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Condition</Label>
                <Select
                  value={newRule.conditionType}
                  onValueChange={(v) => setNewRule({ ...newRule, conditionType: v as AlertCondition["type"] })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="new_issue">New Issue</SelectItem>
                    <SelectItem value="monitor_down">Monitor Down</SelectItem>
                    <SelectItem value="monitor_recovery">Monitor Recovery</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {newRule.conditionType === "new_issue" && (
                <div className="space-y-2">
                  <Label>Issue Level (optional)</Label>
                  <Select
                    value={newRule.level || "all"}
                    onValueChange={(v) => setNewRule({ ...newRule, level: v === "all" ? "" : v })}
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
                        checked={newRule.channelIds.includes(channel.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setNewRule({ ...newRule, channelIds: [...newRule.channelIds, channel.id] });
                          } else {
                            setNewRule({ ...newRule, channelIds: newRule.channelIds.filter((id) => id !== channel.id) });
                          }
                        }}
                        className="rounded"
                      />
                      <span className="text-sm">{channel.name}</span>
                      <span className="text-xs text-muted-foreground capitalize">({channel.channel_type})</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <Button variant="outline" onClick={() => setShowCreateRule(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleCreateRule}
                disabled={isCreating || !newRule.name || newRule.channelIds.length === 0}
              >
                {isCreating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create Rule
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Create Channel Modal */}
      {showCreateChannel && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm">
          <div className="fixed left-[50%] top-[50%] z-50 w-full max-w-md translate-x-[-50%] translate-y-[-50%] border bg-background shadow-lg sm:rounded-lg p-6">
            <h2 className="text-lg font-semibold mb-4">Add Notification Channel</h2>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="channelName">Name</Label>
                <Input
                  id="channelName"
                  placeholder="Team email"
                  value={newChannel.name}
                  onChange={(e) => setNewChannel({ ...newChannel, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Type</Label>
                <Select
                  value={newChannel.type}
                  onValueChange={(v) => setNewChannel({ ...newChannel, type: v as "email" | "webhook" | "slack" })}
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
                    Webhook and Slack channels require Pro plan.{" "}
                    <UpgradeLink feature="webhooks">Upgrade now</UpgradeLink>
                  </p>
                )}
              </div>
              {newChannel.type === "email" && (
                <div className="space-y-2">
                  <Label htmlFor="emails">Recipients (comma-separated)</Label>
                  <Input
                    id="emails"
                    placeholder="team@example.com, alerts@example.com"
                    value={newChannel.emails}
                    onChange={(e) => setNewChannel({ ...newChannel, emails: e.target.value })}
                  />
                </div>
              )}
              {newChannel.type === "webhook" && (
                <div className="space-y-2">
                  <Label htmlFor="webhookUrl">Webhook URL</Label>
                  <Input
                    id="webhookUrl"
                    placeholder="https://api.example.com/webhook"
                    value={newChannel.webhookUrl}
                    onChange={(e) => setNewChannel({ ...newChannel, webhookUrl: e.target.value })}
                  />
                </div>
              )}
              {newChannel.type === "slack" && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="slackUrl">Slack Webhook URL</Label>
                    <Input
                      id="slackUrl"
                      placeholder="https://hooks.slack.com/services/..."
                      value={newChannel.slackUrl}
                      onChange={(e) => setNewChannel({ ...newChannel, slackUrl: e.target.value })}
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
                        <div
                          key={block.block_type}
                          className="flex items-center justify-between p-2 rounded border bg-card"
                        >
                          <span className="text-sm capitalize">
                            {block.block_type === "header" && "📌 Header (Title with severity)"}
                            {block.block_type === "message" && "📝 Message (Error details)"}
                            {block.block_type === "context" && "ℹ️ Context (Project, severity, time)"}
                            {block.block_type === "stats" && "📊 Stats (Event count, users)"}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              const newBlocks = [...slackTemplate.blocks];
                              newBlocks[index] = { ...block, enabled: !block.enabled };
                              setSlackTemplate({ ...slackTemplate, blocks: newBlocks });
                            }}
                            className={`px-2 py-1 text-xs rounded ${
                              block.enabled
                                ? "bg-primary text-primary-foreground"
                                : "bg-muted text-muted-foreground"
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
                    <p className="text-xs text-muted-foreground">
                      Add quick action buttons to your Slack messages.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const hasViewIssue = slackTemplate.actions.some(
                            (a) => a.action_type === "view_issue"
                          );
                          if (hasViewIssue) {
                            setSlackTemplate({
                              ...slackTemplate,
                              actions: slackTemplate.actions.filter(
                                (a) => a.action_type !== "view_issue"
                              ),
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
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-card border-muted-foreground/20"
                        }`}
                      >
                        🔗 View Issue
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const hasResolve = slackTemplate.actions.some(
                            (a) => a.action_type === "resolve"
                          );
                          if (hasResolve) {
                            setSlackTemplate({
                              ...slackTemplate,
                              actions: slackTemplate.actions.filter(
                                (a) => a.action_type !== "resolve"
                              ),
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
                            : "bg-card border-muted-foreground/20"
                        }`}
                      >
                        ✓ Resolve
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const hasMute = slackTemplate.actions.some(
                            (a) => a.action_type === "mute"
                          );
                          if (hasMute) {
                            setSlackTemplate({
                              ...slackTemplate,
                              actions: slackTemplate.actions.filter(
                                (a) => a.action_type !== "mute"
                              ),
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
                            : "bg-card border-muted-foreground/20"
                        }`}
                      >
                        🔕 Mute
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <Button variant="outline" onClick={() => setShowCreateChannel(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleCreateChannel}
                disabled={isCreating || !newChannel.name}
              >
                {isCreating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Add Channel
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
