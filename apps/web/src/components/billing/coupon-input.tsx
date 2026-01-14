'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Loader2, Check, X, Tag, Percent } from 'lucide-react';
import { billingApi, type CouponInfo } from '@/lib/api';

interface CouponInputProps {
  onCouponApplied?: (coupon: CouponInfo | null) => void;
  disabled?: boolean;
}

export function CouponInput({ onCouponApplied, disabled }: CouponInputProps) {
  const [code, setCode] = useState('');
  const [validating, setValidating] = useState(false);
  const [appliedCoupon, setAppliedCoupon] = useState<CouponInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleValidate = async () => {
    if (!code.trim()) return;

    setValidating(true);
    setError(null);

    try {
      const coupon = await billingApi.validateCoupon(code.trim());
      if (coupon.valid) {
        setAppliedCoupon(coupon);
        onCouponApplied?.(coupon);
      } else {
        setError('This coupon is not valid or has expired');
      }
    } catch (err) {
      setError('Invalid coupon code');
    } finally {
      setValidating(false);
    }
  };

  const handleRemove = () => {
    setAppliedCoupon(null);
    setCode('');
    setError(null);
    onCouponApplied?.(null);
  };

  const formatDiscount = (coupon: CouponInfo) => {
    if (coupon.percent_off) {
      return `${coupon.percent_off}% off`;
    }
    if (coupon.amount_off && coupon.currency) {
      return `$${(coupon.amount_off / 100).toFixed(2)} off`;
    }
    return 'Discount applied';
  };

  const formatDuration = (coupon: CouponInfo) => {
    switch (coupon.duration) {
      case 'forever':
        return 'Forever';
      case 'once':
        return 'First payment only';
      case 'repeating':
        return coupon.duration_in_months
          ? `${coupon.duration_in_months} month${coupon.duration_in_months > 1 ? 's' : ''}`
          : 'Limited time';
      default:
        return '';
    }
  };

  if (appliedCoupon) {
    return (
      <div className="space-y-2">
        <Label className="text-sm font-medium">Coupon Code</Label>
        <div className="flex items-center justify-between p-3 bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 rounded-lg">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-100 dark:bg-green-900/50 rounded-full">
              <Percent className="h-4 w-4 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-medium text-green-800 dark:text-green-200">
                  {appliedCoupon.name || appliedCoupon.id}
                </span>
                <Badge variant="secondary" className="bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300">
                  {formatDiscount(appliedCoupon)}
                </Badge>
              </div>
              <p className="text-xs text-green-600 dark:text-green-400">
                {formatDuration(appliedCoupon)}
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRemove}
            className="text-green-600 hover:text-green-700 dark:text-green-400"
            disabled={disabled}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Label htmlFor="coupon" className="text-sm font-medium">
        Coupon Code
      </Label>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Tag className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            id="coupon"
            value={code}
            onChange={(e) => {
              setCode(e.target.value.toUpperCase());
              setError(null);
            }}
            placeholder="Enter coupon code"
            className="pl-10"
            disabled={disabled || validating}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleValidate();
              }
            }}
          />
        </div>
        <Button
          onClick={handleValidate}
          disabled={!code.trim() || disabled || validating}
          variant="secondary"
        >
          {validating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <>
              <Check className="h-4 w-4 mr-1" />
              Apply
            </>
          )}
        </Button>
      </div>
      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}
    </div>
  );
}
