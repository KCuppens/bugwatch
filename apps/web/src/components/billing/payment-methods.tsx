'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { CreditCard, Plus, Trash2, Check, Loader2 } from 'lucide-react';
import { billingApi, type PaymentMethod } from '@/lib/api';

interface PaymentMethodsProps {
  isOwner: boolean;
}

export function PaymentMethods({ isOwner }: PaymentMethodsProps) {
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [defaultPaymentMethodId, setDefaultPaymentMethodId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    fetchPaymentMethods();
  }, []);

  async function fetchPaymentMethods() {
    try {
      const response = await billingApi.listPaymentMethods();
      setPaymentMethods(response.payment_methods);
      setDefaultPaymentMethodId(response.default_payment_method || null);
    } catch (error) {
      console.error('Failed to load payment methods:', error);
    } finally {
      setLoading(false);
    }
  }

  const isDefault = (pmId: string) => pmId === defaultPaymentMethodId;

  const handleSetDefault = async (paymentMethodId: string) => {
    setActionLoading(paymentMethodId);
    try {
      await billingApi.setDefaultPaymentMethod(paymentMethodId);
      await fetchPaymentMethods();
    } catch (error) {
      console.error('Failed to set default payment method:', error);
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async (paymentMethodId: string) => {
    const confirmed = window.confirm('Are you sure you want to remove this payment method? This action cannot be undone.');
    if (!confirmed) return;

    setActionLoading(paymentMethodId);
    try {
      await billingApi.deletePaymentMethod(paymentMethodId);
      setPaymentMethods(prev => prev.filter(pm => pm.id !== paymentMethodId));
    } catch (error) {
      console.error('Failed to delete payment method:', error);
    } finally {
      setActionLoading(null);
    }
  };

  const handleAddCard = async () => {
    setActionLoading('add');
    try {
      // Create a setup intent for Stripe Elements (if implementing client-side)
      await billingApi.createSetupIntent();
      // For now, redirect to Stripe's hosted page via billing portal
      const portalResponse = await billingApi.createPortal(window.location.href);
      window.location.href = portalResponse.portal_url;
    } catch (error) {
      console.error('Failed to add payment method:', error);
    } finally {
      setActionLoading(null);
    }
  };

  const getCardBrandIcon = () => {
    return <CreditCard className="h-8 w-8 text-muted-foreground" />;
  };

  if (!isOwner) {
    return null;
  }

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-36" />
          <Skeleton className="h-4 w-48" />
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <CreditCard className="h-5 w-5" />
                Payment Methods
              </CardTitle>
              <CardDescription>
                Manage your saved payment methods
              </CardDescription>
            </div>
            <Button onClick={handleAddCard} disabled={actionLoading === 'add'}>
              {actionLoading === 'add' ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Plus className="h-4 w-4 mr-2" />
              )}
              Add Card
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {paymentMethods.length === 0 ? (
            <div className="text-center py-8">
              <CreditCard className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-sm text-muted-foreground">
                No payment methods saved
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Add a card to enable automatic billing
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {paymentMethods.map((pm) => (
                <div
                  key={pm.id}
                  className="flex items-center justify-between p-4 border rounded-lg"
                >
                  <div className="flex items-center gap-4">
                    {getCardBrandIcon()}
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium capitalize">
                          {pm.card?.brand || pm.type}
                        </span>
                        <span className="text-muted-foreground">
                          ending in {pm.card?.last4 || '****'}
                        </span>
                        {isDefault(pm.id) && (
                          <Badge variant="secondary" className="ml-2">
                            Default
                          </Badge>
                        )}
                      </div>
                      {pm.card && (
                        <p className="text-sm text-muted-foreground">
                          Expires {pm.card.exp_month.toString().padStart(2, '0')}/{pm.card.exp_year}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {!isDefault(pm.id) && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleSetDefault(pm.id)}
                        disabled={actionLoading === pm.id}
                      >
                        {actionLoading === pm.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <>
                            <Check className="h-4 w-4 mr-1" />
                            Set Default
                          </>
                        )}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(pm.id)}
                      disabled={actionLoading === pm.id || isDefault(pm.id)}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
  );
}
