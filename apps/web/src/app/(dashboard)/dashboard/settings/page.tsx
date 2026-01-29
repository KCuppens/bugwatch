"use client";

import { useEffect, useState, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { User, Bell, CreditCard, Shield, CheckCircle, XCircle } from "lucide-react";
import { billingApi, type Organization, type Subscription, type VerifyCheckoutResponse } from "@/lib/api";
import { PlanCard, PricingTable, UsageStats, TeamMembers, CreditPurchase, Invoices, PaymentMethods, BillingDashboard, SeatManagement } from "@/components/billing";
import { useTier, type Tier } from "@/hooks/use-feature";

type Tab = "profile" | "notifications" | "billing" | "security";

export default function SettingsPage() {
  const { user, refreshUser } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const tabParam = searchParams.get("tab") as Tab | null;
  const activeTab: Tab = tabParam && ["profile", "notifications", "billing", "security"].includes(tabParam)
    ? tabParam
    : "profile";

  const success = searchParams.get("success");
  const canceled = searchParams.get("canceled");
  const sessionId = searchParams.get("session_id");

  const [name, setName] = useState(user?.name || "");
  const [verifying, setVerifying] = useState(false);
  const [verificationResult, setVerificationResult] = useState<VerifyCheckoutResponse | null>(null);
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Track if verification has been attempted to prevent duplicate calls
  const verificationAttemptedRef = useRef(false);

  // Billing state
  const [billingLoading, setBillingLoading] = useState(true);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [membersCount, setMembersCount] = useState(1);

  const { tier } = useTier();

  const setActiveTab = (tab: Tab) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", tab);
    // Clear success/canceled/session_id params when switching tabs
    params.delete("success");
    params.delete("canceled");
    params.delete("session_id");
    router.push(`/dashboard/settings?${params.toString()}`);
  };

  // Fetch billing data when on billing tab
  useEffect(() => {
    if (activeTab !== "billing") return;

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
      } catch (error) {
        console.error("Failed to load billing data:", error);
      } finally {
        setBillingLoading(false);
      }
    }

    fetchBillingData();
  }, [activeTab]);

  // Verify checkout session and refresh user data after successful checkout
  useEffect(() => {
    if (success !== "true") return;

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
            } catch {
              // Billing refresh failed, but verification was successful
            }
          } else {
            // Verification returned success: false - still fallback to refresh
            setVerificationError(result.message);
            await refreshUser();
          }
        } catch (error) {
          console.error("Checkout verification failed:", error);
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
        refreshUser();
      }
    }

    verifyAndRefresh();
  }, [success, sessionId, refreshUser, router, searchParams]);

  async function handleSave() {
    setIsSaving(true);
    // TODO: Call API to update user
    await new Promise((resolve) => setTimeout(resolve, 500));
    setIsSaving(false);
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
      refreshUser();
    } catch (error) {
      console.error("Failed to refresh billing data:", error);
    } finally {
      setBillingLoading(false);
    }
  };

  const tabs = [
    { id: "profile" as Tab, label: "Profile", icon: User },
    { id: "notifications" as Tab, label: "Notifications", icon: Bell },
    { id: "billing" as Tab, label: "Billing", icon: CreditCard },
    { id: "security" as Tab, label: "Security", icon: Shield },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground">
          Manage your account and preferences
        </p>
      </div>

      {/* Success/Canceled Messages */}
      {success === "true" && verifying && (
        <div className="flex items-center gap-2 p-4 rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-200">
          <div className="h-5 w-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <span>Verifying your subscription...</span>
        </div>
      )}
      {success === "true" && !verifying && !verificationError && (
        <div className="flex items-center gap-2 p-4 rounded-lg bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 text-green-800 dark:text-green-200">
          <CheckCircle className="h-5 w-5" />
          <span>
            {verificationResult?.already_processed
              ? "Your subscription is already active!"
              : verificationResult?.message || "Your subscription has been updated successfully!"}
          </span>
        </div>
      )}
      {verificationError && (
        <div className="flex items-center gap-2 p-4 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200">
          <XCircle className="h-5 w-5" />
          <span>{verificationError}</span>
        </div>
      )}
      {canceled === "true" && (
        <div className="flex items-center gap-2 p-4 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200">
          <XCircle className="h-5 w-5" />
          <span>Checkout was canceled. No changes were made.</span>
        </div>
      )}

      {/* Navigation */}
      <div className="flex gap-2 border-b pb-4">
        {tabs.map((tab) => (
          <Button
            key={tab.id}
            variant={activeTab === tab.id ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setActiveTab(tab.id)}
          >
            <tab.icon className="mr-2 h-4 w-4" />
            {tab.label}
          </Button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === "profile" && (
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>Your personal information</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" value={user?.email || ""} disabled />
              <p className="text-xs text-muted-foreground">
                Contact support to change your email
              </p>
            </div>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? "Saving..." : "Save Changes"}
            </Button>
          </CardContent>
        </Card>
      )}

      {activeTab === "notifications" && (
        <Card>
          <CardHeader>
            <CardTitle>Notification Preferences</CardTitle>
            <CardDescription>
              Configure how you want to be notified
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              Notification settings coming soon. Configure alert channels in your project settings.
            </p>
          </CardContent>
        </Card>
      )}

      {activeTab === "billing" && (
        <div className="space-y-6">
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
              {subscription?.has_stripe && (
                <BillingDashboard />
              )}

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
              <PricingTable
                currentTier={(organization?.tier || "free") as Tier}
                isOwner={isOwner}
              />

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
              {tier === "team" || tier === "enterprise" ? (
                <TeamMembers isOwner={isOwner} />
              ) : null}

              {/* Payment Methods (Paid plans only) */}
              {subscription?.has_stripe && (
                <PaymentMethods isOwner={isOwner} />
              )}

              {/* Invoices (Paid plans only) */}
              {subscription?.has_stripe && (
                <Invoices />
              )}

              {/* AI Fix Credits */}
              <CreditPurchase currentCredits={user?.credits ?? 0} />
            </>
          )}
        </div>
      )}

      {activeTab === "security" && (
        <Card>
          <CardHeader>
            <CardTitle>Security Settings</CardTitle>
            <CardDescription>
              Manage your account security
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Password</Label>
              <div className="flex items-center gap-2">
                <Input type="password" value="••••••••" disabled />
                <Button variant="outline">Change</Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Two-Factor Authentication</Label>
              <p className="text-sm text-muted-foreground">
                Add an extra layer of security to your account
              </p>
              <Button variant="outline">Enable 2FA</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
