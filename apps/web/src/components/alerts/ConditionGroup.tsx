'use client';

import { AlertCondition } from '@/lib/api';
import { ConditionCard } from './ConditionCard';

interface ConditionGroupProps {
  conditions: AlertCondition[];
  onChange: (conditions: AlertCondition[]) => void;
  operator: 'AND' | 'OR';
  onOperatorChange: (op: 'AND' | 'OR') => void;
}

export function ConditionGroup({
  conditions,
  onChange,
}: ConditionGroupProps) {
  const updateCondition = (index: number, condition: AlertCondition) => {
    const updated = [...conditions];
    updated[index] = condition;
    onChange(updated);
  };

  // Backend supports a single condition per rule
  const condition = conditions[0] || { type: 'new_issue' as const };

  return (
    <div className="space-y-3">
      <label className="text-sm font-medium text-foreground">Condition</label>
      <ConditionCard
        condition={condition}
        onChange={(c) => updateCondition(0, c)}
      />
    </div>
  );
}
