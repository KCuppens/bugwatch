'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Bot, Sparkles, Check } from 'lucide-react';
import { billingApi } from '@/lib/api';
import { cn } from '@/lib/utils';

interface CreditPurchaseProps {
  currentCredits: number;
}

const CREDIT_PACKAGES = [
  { credits: 10, price: 15, popular: false },
  { credits: 25, price: 35, popular: true },
  { credits: 50, price: 65, popular: false },
  { credits: 100, price: 120, popular: false },
];

export function CreditPurchase({ currentCredits }: CreditPurchaseProps) {
  const [loading, setLoading] = useState<number | null>(null);

  const handlePurchase = async (credits: number) => {
    setLoading(credits);
    try {
      const response = await billingApi.purchaseCredits(credits);
      // Redirect to Stripe checkout
      window.location.href = response.checkout_url;
    } catch (error) {
      console.error('Failed to create checkout:', error);
    } finally {
      setLoading(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Bot className="h-5 w-5 text-purple-500" />
              AI Fix Credits
            </CardTitle>
            <CardDescription>
              Purchase credits for AI-powered fix suggestions
            </CardDescription>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold">{currentCredits}</p>
            <p className="text-xs text-muted-foreground">credits available</p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="mb-4">
          <p className="text-sm text-muted-foreground">
            Each AI fix costs 1 credit. Credits never expire and can be used across all your projects.
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {CREDIT_PACKAGES.map((pkg) => (
            <div
              key={pkg.credits}
              className={cn(
                'relative border rounded-lg p-4 text-center transition-colors hover:border-primary',
                pkg.popular && 'border-primary bg-primary/5'
              )}
            >
              {pkg.popular && (
                <Badge className="absolute -top-2 left-1/2 -translate-x-1/2 text-xs">
                  Best Value
                </Badge>
              )}
              <div className="mb-2">
                <p className="text-2xl font-bold">{pkg.credits}</p>
                <p className="text-xs text-muted-foreground">credits</p>
              </div>
              <p className="text-lg font-semibold mb-1">${pkg.price}</p>
              <p className="text-xs text-muted-foreground mb-3">
                ${(pkg.price / pkg.credits).toFixed(2)}/credit
              </p>
              <Button
                size="sm"
                className="w-full"
                variant={pkg.popular ? 'default' : 'outline'}
                onClick={() => handlePurchase(pkg.credits)}
                disabled={loading === pkg.credits}
              >
                {loading === pkg.credits ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>Buy</>
                )}
              </Button>
            </div>
          ))}
        </div>

        <div className="mt-6 p-4 bg-muted/50 rounded-lg">
          <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-purple-500" />
            What you get with AI Fix
          </h4>
          <ul className="text-sm text-muted-foreground space-y-1">
            <li className="flex items-center gap-2">
              <Check className="h-3 w-3 text-green-500" />
              Detailed explanation of the error cause
            </li>
            <li className="flex items-center gap-2">
              <Check className="h-3 w-3 text-green-500" />
              Suggested code fix with context
            </li>
            <li className="flex items-center gap-2">
              <Check className="h-3 w-3 text-green-500" />
              Best practice recommendations
            </li>
            <li className="flex items-center gap-2">
              <Check className="h-3 w-3 text-green-500" />
              Confidence score for the suggestion
            </li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
