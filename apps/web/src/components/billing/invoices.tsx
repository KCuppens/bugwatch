"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { FileText, Download, ExternalLink, ChevronDown, ChevronUp, AlertTriangle } from "lucide-react";
import { billingApi, type Invoice, type InvoiceDetail } from "@/lib/api";
import { toast } from "sonner";

export function Invoices() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedInvoice, setExpandedInvoice] = useState<string | null>(null);
  const [invoiceDetails, setInvoiceDetails] = useState<Record<string, InvoiceDetail>>({});
  const [loadingDetails, setLoadingDetails] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchInvoices() {
      try {
        const response = await billingApi.listInvoices();
        setInvoices(response.invoices);
      } catch (err) {
        console.error("Failed to load invoices:", err);
        setError("Failed to load invoices");
        toast.error("Failed to load invoices");
      } finally {
        setLoading(false);
      }
    }

    fetchInvoices();
  }, []);

  const handleToggleExpand = async (invoiceId: string) => {
    if (expandedInvoice === invoiceId) {
      setExpandedInvoice(null);
      return;
    }

    setExpandedInvoice(invoiceId);

    if (!invoiceDetails[invoiceId]) {
      setLoadingDetails(invoiceId);
      try {
        const details = await billingApi.getInvoice(invoiceId);
        setInvoiceDetails((prev) => ({ ...prev, [invoiceId]: details }));
      } catch (err) {
        console.error("Failed to load invoice details:", err);
        toast.error("Failed to load invoice details");
      } finally {
        setLoadingDetails(null);
      }
    }
  };

  const formatCurrency = (amount: number | null, currency: string | null) => {
    if (amount === null || currency === null) return "$0.00";
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(amount / 100);
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "N/A";
    return new Date(dateStr).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const getStatusBadge = (status: string | null) => {
    switch (status) {
      case "paid":
        return (
          <Badge variant="default" className="bg-green-500" aria-label="Invoice status: Paid">
            Paid
          </Badge>
        );
      case "open":
        return (
          <Badge variant="secondary" aria-label="Invoice status: Open">
            Open
          </Badge>
        );
      case "draft":
        return (
          <Badge variant="outline" aria-label="Invoice status: Draft">
            Draft
          </Badge>
        );
      case "uncollectible":
        return (
          <Badge variant="destructive" aria-label="Invoice status: Uncollectible">
            Uncollectible
          </Badge>
        );
      case "void":
        return (
          <Badge variant="outline" aria-label="Invoice status: Void">
            Void
          </Badge>
        );
      default:
        return (
          <Badge variant="secondary" aria-label={`Invoice status: ${status || "Unknown"}`}>
            {status || "Unknown"}
          </Badge>
        );
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-4 w-48" />
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 p-6">
          <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium">Failed to load invoices</p>
            <p className="text-xs text-muted-foreground mt-0.5">Please try refreshing the page.</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5" aria-hidden="true" />
          Invoices
        </CardTitle>
        <CardDescription>View and download your billing history</CardDescription>
      </CardHeader>
      <CardContent>
        {invoices.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">No invoices yet</p>
        ) : (
          <div className="space-y-2">
            {invoices.map((invoice) => (
              <div key={invoice.id} className="border rounded-lg">
                <div
                  role="button"
                  tabIndex={0}
                  aria-expanded={expandedInvoice === invoice.id}
                  aria-controls={`invoice-details-${invoice.id}`}
                  aria-label={`Toggle details for invoice ${invoice.number || invoice.id.slice(-8)}, ${formatDate(invoice.created)}, ${formatCurrency(invoice.amount_due, invoice.currency)}, status: ${invoice.status ?? "unknown"}`}
                  className="flex items-center justify-between p-4 cursor-pointer hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring rounded-t-lg"
                  onClick={() => handleToggleExpand(invoice.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleToggleExpand(invoice.id);
                    }
                  }}
                >
                  <div className="flex items-center gap-4">
                    <div>
                      <p className="font-medium">{invoice.number || `Invoice ${invoice.id.slice(-8)}`}</p>
                      <p className="text-sm text-muted-foreground">{formatDate(invoice.created)}</p>
                    </div>
                    {getStatusBadge(invoice.status)}
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="font-medium">{formatCurrency(invoice.amount_due, invoice.currency)}</span>
                    {expandedInvoice === invoice.id ? (
                      <ChevronUp className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                </div>

                {expandedInvoice === invoice.id && (
                  <div id={`invoice-details-${invoice.id}`} className="border-t p-4 bg-muted/30">
                    {loadingDetails === invoice.id ? (
                      <div className="space-y-2">
                        <Skeleton className="h-4 w-full" />
                        <Skeleton className="h-4 w-3/4" />
                      </div>
                    ) : invoiceDetails[invoice.id] ? (
                      (() => {
                        const details = invoiceDetails[invoice.id]!;
                        return (
                          <div className="space-y-4">
                            <div className="space-y-2">
                              <p className="text-sm font-medium">Line Items</p>
                              {details.line_items.map((item) => (
                                <div key={item.id} className="flex justify-between text-sm">
                                  <span className="text-muted-foreground">
                                    {item.description || "Subscription"}
                                    {item.quantity && item.quantity > 1 && ` x${item.quantity}`}
                                  </span>
                                  <span>{formatCurrency(item.amount, item.currency)}</span>
                                </div>
                              ))}
                            </div>
                            <div className="border-t pt-2 space-y-1">
                              <div className="flex justify-between text-sm">
                                <span className="text-muted-foreground">Subtotal</span>
                                <span>{formatCurrency(details.subtotal, invoice.currency)}</span>
                              </div>
                              {details.tax && (
                                <div className="flex justify-between text-sm">
                                  <span className="text-muted-foreground">Tax</span>
                                  <span>{formatCurrency(details.tax, invoice.currency)}</span>
                                </div>
                              )}
                              <div className="flex justify-between font-medium">
                                <span>Total</span>
                                <span>{formatCurrency(details.total, invoice.currency)}</span>
                              </div>
                            </div>
                            <div className="flex gap-2 pt-2">
                              {invoice.invoice_pdf && /^https?:\/\//.test(invoice.invoice_pdf) && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  aria-label="Download PDF (opens in new tab)"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    window.open(invoice.invoice_pdf!, "_blank", "noopener,noreferrer");
                                  }}
                                >
                                  <Download className="h-4 w-4 mr-2" aria-hidden="true" />
                                  Download PDF
                                </Button>
                              )}
                              {invoice.hosted_invoice_url && /^https?:\/\//.test(invoice.hosted_invoice_url) && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  aria-label="View invoice online (opens in new tab)"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    window.open(invoice.hosted_invoice_url!, "_blank", "noopener,noreferrer");
                                  }}
                                >
                                  <ExternalLink className="h-4 w-4 mr-2" aria-hidden="true" />
                                  View Online
                                </Button>
                              )}
                            </div>
                          </div>
                        );
                      })()
                    ) : (
                      <p className="text-sm text-muted-foreground">Failed to load invoice details</p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
