'use client';

import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import type { Tier } from '@/hooks/use-feature';

interface PaywallContextValue {
  isOpen: boolean;
  triggerFeature: string | null;
  targetTier: Tier | null;
  openPaywall: (options?: { feature?: string; targetTier?: Tier }) => void;
  closePaywall: () => void;
}

const PaywallContext = createContext<PaywallContextValue | null>(null);

export function PaywallProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [triggerFeature, setTriggerFeature] = useState<string | null>(null);
  const [targetTier, setTargetTier] = useState<Tier | null>(null);

  const openPaywall = useCallback(
    (options?: { feature?: string; targetTier?: Tier }) => {
      setTriggerFeature(options?.feature || null);
      setTargetTier(options?.targetTier || 'pro');
      setIsOpen(true);
    },
    []
  );

  const closePaywall = useCallback(() => {
    setIsOpen(false);
    // Delay clearing feature/tier to allow exit animation
    setTimeout(() => {
      setTriggerFeature(null);
      setTargetTier(null);
    }, 200);
  }, []);

  return (
    <PaywallContext.Provider
      value={{ isOpen, triggerFeature, targetTier, openPaywall, closePaywall }}
    >
      {children}
    </PaywallContext.Provider>
  );
}

export function usePaywall() {
  const context = useContext(PaywallContext);
  if (!context) {
    throw new Error('usePaywall must be used within a PaywallProvider');
  }
  return context;
}
