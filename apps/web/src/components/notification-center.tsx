"use client";

import { useNotifications } from "@/hooks/useNotifications";

import { Bell, AlertCircle, CheckCircle, Clock, XCircle } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function getTriggerIcon(triggerType: string) {
  switch (triggerType) {
    case "threshold_exceeded":
    case "error_spike":
      return <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />;
    case "monitor_down":
      return <XCircle className="h-4 w-4 text-red-500 shrink-0" />;
    case "monitor_up":
    case "resolved":
      return <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />;
    default:
      return <Bell className="h-4 w-4 text-muted-foreground shrink-0" />;
  }
}

export function NotificationCenter() {
  const { notifications, unreadCount, markAllRead } = useNotifications();

  return (
    <DropdownMenu onOpenChange={(open) => { if (open) markAllRead(); }}>
      <DropdownMenuTrigger asChild>
        <button
          aria-label="Notifications"
          className="relative h-9 w-9 rounded-lg flex items-center justify-center hover:bg-surface-3 transition-colors"
        >
          <Bell className="h-4 w-4 text-muted-foreground" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 max-h-96 overflow-y-auto">
        <DropdownMenuLabel className="flex items-center justify-between">
          <span>Notifications</span>
          {notifications.length > 0 && (
            <span className="text-xs font-normal text-muted-foreground">
              {notifications.length} recent
            </span>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8">
            <Bell className="h-6 w-6 text-muted-foreground mb-2" />
            <p className="text-xs text-muted-foreground">No notifications yet</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {notifications.map((notification) => (
              <button
                key={notification.id}
                className="flex items-start gap-3 px-3 py-2.5 hover:bg-muted/50 transition-colors cursor-pointer w-full text-left"
              >
                <div className="mt-0.5">
                  {getTriggerIcon(notification.trigger_type)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate">{notification.message}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] text-muted-foreground font-medium">
                      {notification.project_name}
                    </span>
                    <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                      <Clock className="h-2.5 w-2.5" />
                      {formatRelativeTime(notification.created_at)}
                    </span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
