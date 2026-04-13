"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import type { TransactionAggregate } from "@/lib/api";

interface TransactionTableProps {
  data: TransactionAggregate[];
}

type SortField = "transaction_name" | "count" | "p50" | "p95" | "error_rate" | "avg_duration_ms";
type SortDir = "asc" | "desc";

function formatMs(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(2)}s`;
  return `${Math.round(value)}ms`;
}

export function TransactionTable({ data }: TransactionTableProps) {
  const [sortField, setSortField] = useState<SortField>("count");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  };

  const sorted = [...data].sort((a, b) => {
    const aVal = a[sortField];
    const bVal = b[sortField];
    if (typeof aVal === "string" && typeof bVal === "string") {
      return sortDir === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    }
    const numA = Number(aVal);
    const numB = Number(bVal);
    return sortDir === "asc" ? numA - numB : numB - numA;
  });

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown className="h-3 w-3 ml-1 opacity-40" />;
    return sortDir === "asc"
      ? <ArrowUp className="h-3 w-3 ml-1" />
      : <ArrowDown className="h-3 w-3 ml-1" />;
  };

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
        No transactions found
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border-subtle text-muted-foreground">
            <th className="text-left py-3 px-3 font-medium">
              <button onClick={() => handleSort("transaction_name")} className="flex items-center hover:text-foreground">
                Transaction <SortIcon field="transaction_name" />
              </button>
            </th>
            <th className="text-right py-3 px-3 font-medium">
              <button onClick={() => handleSort("count")} className="flex items-center justify-end hover:text-foreground ml-auto">
                Count <SortIcon field="count" />
              </button>
            </th>
            <th className="text-right py-3 px-3 font-medium">
              <button onClick={() => handleSort("p50")} className="flex items-center justify-end hover:text-foreground ml-auto">
                P50 <SortIcon field="p50" />
              </button>
            </th>
            <th className="text-right py-3 px-3 font-medium">
              <button onClick={() => handleSort("p95")} className="flex items-center justify-end hover:text-foreground ml-auto">
                P95 <SortIcon field="p95" />
              </button>
            </th>
            <th className="text-right py-3 px-3 font-medium">
              <button onClick={() => handleSort("avg_duration_ms")} className="flex items-center justify-end hover:text-foreground ml-auto">
                Avg <SortIcon field="avg_duration_ms" />
              </button>
            </th>
            <th className="text-right py-3 px-3 font-medium">
              <button onClick={() => handleSort("error_rate")} className="flex items-center justify-end hover:text-foreground ml-auto">
                Error Rate <SortIcon field="error_rate" />
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((txn) => (
            <tr
              key={txn.transaction_name}
              className="border-b border-border-subtle/50 hover:bg-surface-3/50 transition-colors"
            >
              <td className="py-3 px-3 font-mono text-xs truncate max-w-[300px]" title={txn.transaction_name}>
                {txn.transaction_name}
              </td>
              <td className="py-3 px-3 text-right tabular-nums">
                {txn.count.toLocaleString()}
              </td>
              <td className="py-3 px-3 text-right tabular-nums">
                {formatMs(txn.p50)}
              </td>
              <td className="py-3 px-3 text-right tabular-nums">
                <span className={cn(txn.p95 > 1000 && "text-yellow-400", txn.p95 > 3000 && "text-red-400")}>
                  {formatMs(txn.p95)}
                </span>
              </td>
              <td className="py-3 px-3 text-right tabular-nums">
                {formatMs(txn.avg_duration_ms)}
              </td>
              <td className="py-3 px-3 text-right tabular-nums">
                <span className={cn(
                  txn.error_rate > 5 && "text-yellow-400",
                  txn.error_rate > 10 && "text-red-400",
                )}>
                  {txn.error_rate.toFixed(1)}%
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
