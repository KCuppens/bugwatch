"use client";

import { useEffect, useState } from "react";
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
import { billingApi, type Organization, type Subscription } from "@/lib/api";
import { PlanCard, UsageStats, TeamMembers, CreditPurchase, Invoices, PaymentMethods, BillingDashboard, SeatManagement } from "@/components/billing";
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

  const [name, setName] = useState(user?.name || "");
  const [isSaving, setIsSaving] = useState(false);

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
    // Clear success/canceled params when switching tabs
    params.delete("success");
    params.delete("canceled");
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

  // Refresh user data after successful checkout
  useEffect(() => {
    if (success === "true") {
      refreshUser();
    }
  }, [success, refreshUser]);

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
      {success === "true" && (
        <div className="flex items-center gap-2 p-4 rounded-lg bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 text-green-800 dark:text-green-200">
          <CheckCircle className="h-5 w-5" />
          <span>Your subscription has been updated successfully!</span>
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
                  <Skeleton className="h-24 w-full" />
                </CardContent>
              </Card>
            </>
          ) : (
            <>
              {/* Billing Dashboard - Overview */}
              {subscription?.has_stripe && (
                <BillingDashboard />
              )}

              {/* Current Plan */}
              <PlanCard
                organization={organization}
                subscription={subscription}
                isOwner={isOwner}
                onRefresh={handleRefreshBilling}
              />

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

              {/* Usage Stats */}
              <UsageStats tier={(organization?.tier || "free") as Tier} />

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
