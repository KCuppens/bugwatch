'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Loader2, Users, AlertCircle, Plus, Minus } from 'lucide-react';
import { billingApi, type ProrationPreview, type Organization } from '@/lib/api';
import { getTierPrice, type Tier } from '@/hooks/use-feature';

interface SeatManagementProps {
  organization: Organization | null;
  currentSeats: number;
  usedSeats: number;
  isOwner: boolean;
  onUpdate: () => void;
}

export function SeatManagement({
  organization,
  currentSeats,
  usedSeats,
  isOwner,
  onUpdate,
}: SeatManagementProps) {
  const [seats, setSeats] = useState(currentSeats);
  const [preview, setPreview] = useState<ProrationPreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tier = (organization?.tier || 'free') as Tier;
  const pricePerSeat = getTierPrice(tier);
  const minSeats = Math.max(usedSeats, 1);
  const maxSeats = 100;

  const handleSeatsChange = async (newSeats: number) => {
    if (newSeats < minSeats || newSeats > maxSeats) return;

    setSeats(newSeats);
    setError(null);

    if (newSeats === currentSeats) {
      setPreview(null);
      return;
    }

    setLoadingPreview(true);
    try {
      const previewData = await billingApi.previewPlanChange(
        tier,
        newSeats,
        organization?.subscription_status === 'annual'
      );
      setPreview(previewData);
    } catch (err) {
      console.error('Failed to get preview:', err);
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleUpdate = async () => {
    if (seats === currentSeats) return;

    setUpdating(true);
    setError(null);
    try {
      await billingApi.updateSeats(seats);
      onUpdate();
    } catch (err) {
      setError('Failed to update seats. Please try again.');
      console.error('Failed to update seats:', err);
    } finally {
      setUpdating(false);
    }
  };

  const formatCurrency = (amount: number) => {
    const sign = amount < 0 ? '-' : '';
    return `${sign}$${(Math.abs(amount) / 100).toFixed(2)}`;
  };

  if (!isOwner || tier === 'free') {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5" />
          Seat Management
        </CardTitle>
        <CardDescription>
          Adjust the number of seats in your subscription
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Current Usage */}
        <div className="flex justify-between items-center p-4 bg-muted/50 rounded-lg">
          <div>
            <p className="font-medium">Current Usage</p>
            <p className="text-sm text-muted-foreground">
              {usedSeats} of {currentSeats} seats used
            </p>
          </div>
          <div className="text-right">
            <p className="font-medium">${pricePerSeat}/seat/mo</p>
            <p className="text-sm text-muted-foreground">
              ${pricePerSeat * currentSeats}/mo total
            </p>
          </div>
        </div>

        {/* Seat Controls */}
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <span className="text-sm font-medium">Adjust Seats</span>
          </div>
          <div className="flex items-center justify-center gap-4">
            <Button
              variant="outline"
              size="icon"
              onClick={() => handleSeatsChange(seats - 1)}
              disabled={seats <= minSeats || loadingPreview}
            >
              <Minus className="h-4 w-4" />
            </Button>
            <div className="w-20">
              <Input
                type="number"
                value={seats}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (!isNaN(val)) handleSeatsChange(val);
                }}
                min={minSeats}
                max={maxSeats}
                className="text-center text-xl font-bold"
                disabled={loadingPreview}
              />
            </div>
            <Button
              variant="outline"
              size="icon"
              onClick={() => handleSeatsChange(seats + 1)}
              disabled={seats >= maxSeats || loadingPreview}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <div className="text-center text-xs text-muted-foreground">
            Min: {minSeats} | Max: {maxSeats}
          </div>
        </div>

        {/* Proration Preview */}
        {loadingPreview && (
          <div className="flex items-center justify-center p-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {preview && !loadingPreview && seats !== currentSeats && (
          <div className="space-y-2 p-4 border rounded-lg">
            <p className="font-medium">Price Change</p>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Current monthly rate</span>
                <span>{formatCurrency(preview.current_amount_cents)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">New monthly rate</span>
                <span>{formatCurrency(preview.new_amount_cents)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Proration adjustment</span>
                <span className={preview.proration_amount_cents < 0 ? 'text-green-600' : ''}>
                  {formatCurrency(preview.proration_amount_cents)}
                </span>
              </div>
              <div className="flex justify-between font-medium pt-2 border-t">
                <span>
                  {preview.immediate_charge ? 'Charge due now' : 'Applied at next billing'}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Warning for reducing below used */}
        {seats < usedSeats && (
          <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg text-amber-800 dark:text-amber-200">
            <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium">Cannot reduce below used seats</p>
              <p>You currently have {usedSeats} team members. Remove members first to reduce seats.</p>
            </div>
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg text-red-800 dark:text-red-200">
            <AlertCircle className="h-5 w-5" />
            <span className="text-sm">{error}</span>
          </div>
        )}

        {/* Update Button */}
        <Button
          className="w-full"
          onClick={handleUpdate}
          disabled={seats === currentSeats || seats < usedSeats || updating}
        >
          {updating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          {seats === currentSeats
            ? 'No changes'
            : seats > currentSeats
            ? `Add ${seats - currentSeats} seat${seats - currentSeats > 1 ? 's' : ''}`
            : `Remove ${currentSeats - seats} seat${currentSeats - seats > 1 ? 's' : ''}`}
        </Button>
      </CardContent>
    </Card>
  );
}
