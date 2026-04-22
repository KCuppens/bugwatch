"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { User, Bell, CreditCard, Shield, CheckCircle, XCircle, Lock, Smartphone, Monitor, Plug } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  authApi,
  billingApi,
  ApiError,
  type Organization,
  type Subscription,
  type VerifyCheckoutResponse,
} from "@/lib/api";
import {
  PlanCard,
  PricingTable,
  UsageStats,
  TeamMembers,
  Invoices,
  PaymentMethods,
  BillingDashboard,
  SeatManagement,
} from "@/components/billing";
import { IntegrationSettings } from "@/components/integrations";
import { useTier, useFeature, isSelfHosted, type Tier } from "@/hooks/use-feature";

type Tab = "profile" | "notifications" | "billing" | "security" | "integrations";

const DEFAULT_NOTIF_PREFS = {
  emailDigest: true,
  inAppBadges: true,
  criticalAlerts: true,
  weeklyReport: false,
  quietHoursEnabled: false,
};

function parseNotifPrefs(raw: string): typeof DEFAULT_NOTIF_PREFS {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return DEFAULT_NOTIF_PREFS;
  const p = parsed as Record<string, unknown>;
  return {
    emailDigest: typeof p.emailDigest === "boolean" ? p.emailDigest : DEFAULT_NOTIF_PREFS.emailDigest,
    inAppBadges: typeof p.inAppBadges === "boolean" ? p.inAppBadges : DEFAULT_NOTIF_PREFS.inAppBadges,
    criticalAlerts: typeof p.criticalAlerts === "boolean" ? p.criticalAlerts : DEFAULT_NOTIF_PREFS.criticalAlerts,
    weeklyReport: typeof p.weeklyReport === "boolean" ? p.weeklyReport : DEFAULT_NOTIF_PREFS.weeklyReport,
    quietHoursEnabled:
      typeof p.quietHoursEnabled === "boolean" ? p.quietHoursEnabled : DEFAULT_NOTIF_PREFS.quietHoursEnabled,
  };
}

export default function SettingsPage() {
  const { user, refreshUser } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const tabParam = searchParams.get("tab") as Tab | null;
  const activeTab: Tab =
    tabParam && ["profile", "notifications", "billing", "security", "integrations"].includes(tabParam)
      ? tabParam
      : "profile";

  const success = searchParams.get("success");
  const canceled = searchParams.get("canceled");
  const sessionId = searchParams.get("session_id");

  const [name, setName] = useState(user?.name || "");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [savedLabel, setSavedLabel] = useState<string>("");
  const [verifying, setVerifying] = useState(false);
  const [verificationResult, setVerificationResult] = useState<VerifyCheckoutResponse | null>(null);
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordCooldown, setPasswordCooldown] = useState(false);

  // Notification preferences (localStorage)
  const [notifPrefs, setNotifPrefs] = useState(() => {
    if (typeof window === "undefined") return DEFAULT_NOTIF_PREFS;
    try {
      const stored = localStorage.getItem("bugwatch-notification-prefs");
      if (stored) return parseNotifPrefs(stored);
    } catch (e) {
      console.warn("Failed to parse notification preferences from localStorage:", e);
    }
    return DEFAULT_NOTIF_PREFS;
  });

  // Track if verification has been attempted to prevent duplicate calls
  const verificationAttemptedRef = useRef(false);

  // Billing state
  const [billingLoading, setBillingLoading] = useState(true);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [membersCount, setMembersCount] = useState(1);

  const { tier } = useTier();
  const hasIntegrations = useFeature("github");

  const setActiveTab = (tab: Tab) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", tab);
    // Clear success/canceled/session_id params when switching tabs
    params.delete("success");
    params.delete("canceled");
    params.delete("session_id");
    router.push(`/dashboard/settings?${params.toString()}`);
  };

  // Fetch billing data when on billing tab (SaaS only)
  useEffect(() => {
    if (activeTab !== "billing" || isSelfHosted()) return;

    async function fetchBillingData() {
      setBillingLoading(true);
      try {
        const [orgResponse, subResponse] = await Promise.all([
          billingApi.getOrganization(),
          billingApi.getSubscription(),
        ]);
        setOrganization(orgResponse.organization);
        setIsOwner(orgResponse.is_owner);
        setSubscription(subResponse);
        setMembersCount(orgResponse.members_count);
      } catch {
        toast.error("Failed to load billing data");
      } finally {
        setBillingLoading(false);
      }
    }

    fetchBillingData();
  }, [activeTab]);

  // Verify checkout session and refresh user data after successful checkout (SaaS only)
  useEffect(() => {
    if (success !== "true" || isSelfHosted()) return;

    // Prevent duplicate verification attempts
    if (verificationAttemptedRef.current) return;
    verificationAttemptedRef.current = true;

    async function verifyAndRefresh() {
      // If we have a session ID, verify it directly with Stripe
      if (sessionId) {
        setVerifying(true);
        setVerificationError(null);
        try {
          const result = await billingApi.verifyCheckout(sessionId);
          setVerificationResult(result);
          if (result.success) {
            // Verification successful - refresh user data
            await refreshUser();
            // Also refresh billing data
            try {
              const [orgResponse, subResponse] = await Promise.all([
                billingApi.getOrganization(),
                billingApi.getSubscription(),
              ]);
              setOrganization(orgResponse.organization);
              setIsOwner(orgResponse.is_owner);
              setSubscription(subResponse);
              setMembersCount(orgResponse.members_count);
            } catch (err) {
              console.warn("[billing] Refresh after checkout verification failed:", err);
              toast.info("Subscription verified — refresh the page if plan details look outdated");
            }
          } else {
            // Verification returned success: false - still fallback to refresh
            setVerificationError(result.message);
            await refreshUser();
          }
        } catch {
          toast.error("Checkout verification failed");
          setVerificationError("Failed to verify checkout. Refreshing subscription data...");
          // Fallback to regular refresh
          await refreshUser();
        } finally {
          setVerifying(false);
          // Clean up URL params after verification attempt
          const params = new URLSearchParams(searchParams.toString());
          params.delete("session_id");
          // Keep success=true to show the message, but remove session_id to prevent re-verification
          router.replace(`/dashboard/settings?${params.toString()}`, { scroll: false });
        }
      } else {
        // No session ID - fallback to regular refresh (legacy behavior)
        await refreshUser();
      }
    }

    verifyAndRefresh();
  }, [success, sessionId, refreshUser, router, searchParams]);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      await authApi.updateProfile({ name: name.trim() });
      await refreshUser();
      setLastSavedAt(new Date());
      setSavedLabel("Saved just now");
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Failed to save profile";
      toast.error(message);
    } finally {
      setIsSaving(false);
    }
  }, [name, refreshUser]);

  // Autosave profile name — debounce 800ms after last change
  useEffect(() => {
    if (!user || !name.trim() || name.trim() === (user.name || "")) return;
    const handle = setTimeout(() => {
      void handleSave();
    }, 800);
    return () => clearTimeout(handle);
  }, [name, user, handleSave]);

  // Ghost text ticker — "Saved Ns ago"
  useEffect(() => {
    if (!lastSavedAt) return;
    const tick = () => {
      const secs = Math.floor((Date.now() - lastSavedAt.getTime()) / 1000);
      if (secs < 5) setSavedLabel("Saved just now");
      else if (secs < 60) setSavedLabel(`Saved ${secs}s ago`);
      else if (secs < 3600) setSavedLabel(`Saved ${Math.floor(secs / 60)}m ago`);
      else setSavedLabel(`Saved ${Math.floor(secs / 3600)}h ago`);
    };
    tick();
    // 30s interval is sufficient for minute-level display granularity
    const i = setInterval(tick, 30_000);
    return () => clearInterval(i);
  }, [lastSavedAt]);

  function updateNotifPref(key: keyof typeof DEFAULT_NOTIF_PREFS, value: boolean) {
    const updated = { ...notifPrefs, [key]: value };
    setNotifPrefs(updated);
    localStorage.setItem("bugwatch-notification-prefs", JSON.stringify(updated));
    toast.success("Notification preference updated");
  }

  async function handlePasswordChange() {
    if (passwordCooldown) return;
    if (newPassword !== confirmPassword) {
      toast.error("Passwords don't match");
      return;
    }
    if (newPassword.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    try {
      await authApi.changePassword(currentPassword, newPassword);
      // Activate cooldown only on success so users can retry immediately on error
      setPasswordCooldown(true);
      setTimeout(() => setPasswordCooldown(false), 2000);
      toast.success("Password changed successfully");
      setPasswordDialogOpen(false);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Failed to change password";
      toast.error(message);
    }
  }

  const handleRefreshBilling = async () => {
    setBillingLoading(true);
    try {
      const [orgResponse, subResponse] = await Promise.all([
        billingApi.getOrganization(),
        billingApi.getSubscription(),
      ]);
      setOrganization(orgResponse.organization);
      setIsOwner(orgResponse.is_owner);
      setSubscription(subResponse);
      setMembersCount(orgResponse.members_count);
      await refreshUser();
    } catch {
      toast.error("Failed to refresh billing data");
    } finally {
      setBillingLoading(false);
    }
  };

  const tabs = [
    { id: "profile" as Tab, label: "Profile", icon: User },
    { id: "notifications" as Tab, label: "Notifications", icon: Bell },
    ...(!isSelfHosted() ? [{ id: "billing" as Tab, label: "Billing", icon: CreditCard }] : []),
    ...(hasIntegrations ? [{ id: "integrations" as Tab, label: "Integrations", icon: Plug }] : []),
    { id: "security" as Tab, label: "Security", icon: Shield },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-display text-heading-lg">Settings</h1>
        <p className="text-body-sm text-muted-foreground mt-1">Manage your account and preferences</p>
      </div>

      {/* Success/Canceled Messages */}
      {!isSelfHosted() && success === "true" && verifying && (
        <div
          role="alert"
          aria-busy="true"
          className="flex items-center gap-2 p-4 rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-200"
        >
          <div
            className="h-5 w-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"
            aria-hidden="true"
          />
          <span>Verifying your subscription...</span>
        </div>
      )}
      {!isSelfHosted() && success === "true" && !verifying && !verificationError && verificationResult !== null && (
        <div
          role="alert"
          className="flex items-center gap-2 p-4 rounded-lg bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 text-green-800 dark:text-green-200"
        >
          <CheckCircle className="h-5 w-5" />
          <span>
            {verificationResult.already_processed
              ? "Your subscription is already active!"
              : verificationResult.message || "Your subscription has been updated successfully!"}
          </span>
        </div>
      )}
      {!isSelfHosted() && verificationError && (
        <div
          role="alert"
          className="flex items-center gap-2 p-4 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200"
        >
          <XCircle className="h-5 w-5" />
          <span>{verificationError}</span>
        </div>
      )}
      {!isSelfHosted() && canceled === "true" && (
        <div
          role="alert"
          className="flex items-center gap-2 p-4 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200"
        >
          <XCircle className="h-5 w-5" />
          <span>Checkout was canceled. No changes were made.</span>
        </div>
      )}

      {/* Navigation */}
      <div
        role="tablist"
        aria-label="Settings sections"
        className="flex gap-2 border-b border-border-subtle pb-4 overflow-x-auto scrollbar-hide -mx-1 px-1"
      >
        {tabs.map((tab) => (
          <Button
            key={tab.id}
            id={`settings-tab-${tab.id}`}
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls={`settings-panel-${tab.id}`}
            variant={activeTab === tab.id ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setActiveTab(tab.id)}
            className="shrink-0"
          >
            <tab.icon className="mr-2 h-4 w-4" aria-hidden="true" />
            {tab.label}
          </Button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === "profile" && (
        <Card role="tabpanel" id="settings-panel-profile" aria-labelledby="settings-tab-profile">
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>Your personal information</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" value={user?.email || ""} disabled />
              <p className="text-xs text-muted-foreground">Contact support to change your email</p>
            </div>
            <div className="flex items-center gap-3">
              <Button onClick={handleSave} disabled={isSaving}>
                {isSaving ? "Saving..." : "Save Changes"}
              </Button>
              {savedLabel && (
                <span className="text-caption text-muted-foreground tabular-nums">
                  {isSaving ? "Saving…" : savedLabel}
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {activeTab === "notifications" && (
        <div
          role="tabpanel"
          id="settings-panel-notifications"
          aria-labelledby="settings-tab-notifications"
          className="space-y-6"
        >
          <Card>
            <CardHeader>
              <CardTitle>Notification Preferences</CardTitle>
              <CardDescription>Configure how you want to be notified</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="notif-email-digest">Email Digest</Label>
                  <p className="text-xs text-muted-foreground">Receive a daily summary of new issues</p>
                </div>
                <Switch
                  id="notif-email-digest"
                  checked={notifPrefs.emailDigest}
                  onCheckedChange={(v) => updateNotifPref("emailDigest", v)}
                />
              </div>
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="notif-in-app-badges">In-App Badges</Label>
                  <p className="text-xs text-muted-foreground">Show unread count badges on navigation items</p>
                </div>
                <Switch
                  id="notif-in-app-badges"
                  checked={notifPrefs.inAppBadges}
                  onCheckedChange={(v) => updateNotifPref("inAppBadges", v)}
                />
              </div>
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="notif-critical-alerts">Critical Alerts</Label>
                  <p className="text-xs text-muted-foreground">Immediately notify for fatal and critical issues</p>
                </div>
                <Switch
                  id="notif-critical-alerts"
                  checked={notifPrefs.criticalAlerts}
                  onCheckedChange={(v) => updateNotifPref("criticalAlerts", v)}
                />
              </div>
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="notif-weekly-report">Weekly Report</Label>
                  <p className="text-xs text-muted-foreground">Get a weekly email with project health overview</p>
                </div>
                <Switch
                  id="notif-weekly-report"
                  checked={notifPrefs.weeklyReport}
                  onCheckedChange={(v) => updateNotifPref("weeklyReport", v)}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Quiet Hours</CardTitle>
              <CardDescription>Pause non-critical notifications during specific hours</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="notif-quiet-hours">Enable Quiet Hours</Label>
                  <p className="text-xs text-muted-foreground">10 PM — 8 AM local time</p>
                </div>
                <Switch
                  id="notif-quiet-hours"
                  checked={notifPrefs.quietHoursEnabled}
                  onCheckedChange={(v) => updateNotifPref("quietHoursEnabled", v)}
                />
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {activeTab === "billing" && !isSelfHosted() && (
        <div role="tabpanel" id="settings-panel-billing" aria-labelledby="settings-tab-billing" className="space-y-6">
          {billingLoading ? (
            <>
              <Card>
                <CardHeader>
                  <Skeleton className="h-6 w-32" />
                  <Skeleton className="h-4 w-48" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-32 w-full" />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <Skeleton className="h-6 w-32" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-64 w-full" />
                </CardContent>
              </Card>
            </>
          ) : (
            <>
              {/* Billing Dashboard - Overview (Paid plans only) */}
              {subscription?.has_stripe && <BillingDashboard />}

              {/* Current Plan Summary (Paid plans only) */}
              {subscription?.has_stripe && (
                <PlanCard
                  organization={organization}
                  subscription={subscription}
                  isOwner={isOwner}
                  onRefresh={handleRefreshBilling}
                />
              )}

              {/* Pricing Table - Always visible */}
              <PricingTable currentTier={(organization?.tier || "free") as Tier} isOwner={isOwner} />

              {/* Usage Stats */}
              <UsageStats tier={(organization?.tier || "free") as Tier} />

              {/* Seat Management (Paid plans only) */}
              {subscription?.has_stripe && isOwner && (tier === "pro" || tier === "team" || tier === "enterprise") && (
                <SeatManagement
                  organization={organization}
                  currentSeats={organization?.seats || 1}
                  usedSeats={membersCount}
                  isOwner={isOwner}
                  onUpdate={handleRefreshBilling}
                />
              )}

              {/* Team Members (Team+ only) */}
              {tier === "team" || tier === "enterprise" ? <TeamMembers isOwner={isOwner} /> : null}

              {/* Payment Methods (Paid plans only) */}
              {subscription?.has_stripe && <PaymentMethods isOwner={isOwner} />}

              {/* Invoices (Paid plans only) */}
              {subscription?.has_stripe && <Invoices />}
            </>
          )}
        </div>
      )}

      {activeTab === "integrations" && hasIntegrations && (
        <div role="tabpanel" id="settings-panel-integrations" aria-labelledby="settings-tab-integrations">
          <IntegrationSettings />
        </div>
      )}

      {activeTab === "security" && (
        <div role="tabpanel" id="settings-panel-security" aria-labelledby="settings-tab-security" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Password</CardTitle>
              <CardDescription>Change your account password</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="rounded-md bg-muted p-2">
                    <Lock className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Password</p>
                    <p className="text-xs text-muted-foreground">Last changed: Never recorded</p>
                  </div>
                </div>
                <Button variant="outline" onClick={() => setPasswordDialogOpen(true)}>
                  Change Password
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Two-Factor Authentication</CardTitle>
              <CardDescription>Add an extra layer of security to your account</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="rounded-md bg-muted p-2">
                    <Smartphone className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Authenticator App</p>
                    <p className="text-xs text-muted-foreground">Not configured</p>
                  </div>
                </div>
                <Button variant="outline" disabled className="opacity-60">
                  Enable 2FA (Coming Soon)
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Active Sessions</CardTitle>
              <CardDescription>Devices currently logged in to your account</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between py-2">
                <div className="flex items-center gap-3">
                  <div className="rounded-md bg-green-500/10 p-2">
                    <Monitor className="h-4 w-4 text-green-500" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Current Session</p>
                    <p className="text-xs text-muted-foreground">
                      {typeof navigator !== "undefined"
                        ? navigator.userAgent.split(" ").slice(-1)[0]?.split("/")[0] || "Browser"
                        : "Browser"}{" "}
                      — Active now
                    </p>
                  </div>
                </div>
                <span className="inline-flex items-center rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-500">
                  Current
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Password Change Dialog */}
          <Dialog open={passwordDialogOpen} onOpenChange={setPasswordDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Change Password</DialogTitle>
                <DialogDescription>Enter your current password and choose a new one.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="current-password">Current Password</Label>
                  <Input
                    id="current-password"
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-password">New Password</Label>
                  <Input
                    id="new-password"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm-password">Confirm New Password</Label>
                  <Input
                    id="confirm-password"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setPasswordDialogOpen(false)}>
                  Cancel
                </Button>
                {passwordCooldown && (
                  <span id="pwd-cooldown-msg" className="sr-only" aria-live="polite">
                    Please wait before changing your password again.
                  </span>
                )}
                <Button
                  onClick={handlePasswordChange}
                  disabled={passwordCooldown}
                  aria-describedby={passwordCooldown ? "pwd-cooldown-msg" : undefined}
                >
                  {passwordCooldown ? "Please wait..." : "Change Password"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      )}
    </div>
  );
}
