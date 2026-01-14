'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { FileText, Download, ExternalLink, ChevronDown, ChevronUp } from 'lucide-react';
import { billingApi, type Invoice, type InvoiceDetail } from '@/lib/api';

export function Invoices() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedInvoice, setExpandedInvoice] = useState<string | null>(null);
  const [invoiceDetails, setInvoiceDetails] = useState<Record<string, InvoiceDetail>>({});
  const [loadingDetails, setLoadingDetails] = useState<string | null>(null);

  useEffect(() => {
    async function fetchInvoices() {
      try {
        const response = await billingApi.listInvoices();
        setInvoices(response.invoices);
      } catch (error) {
        console.error('Failed to load invoices:', error);
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
        setInvoiceDetails(prev => ({ ...prev, [invoiceId]: details }));
      } catch (error) {
        console.error('Failed to load invoice details:', error);
      } finally {
        setLoadingDetails(null);
      }
    }
  };

  const formatCurrency = (amount: number | null, currency: string | null) => {
    if (amount === null || currency === null) return '$0.00';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(amount / 100);
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'N/A';
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const getStatusBadge = (status: string | null) => {
    switch (status) {
      case 'paid':
        return <Badge variant="default" className="bg-green-500">Paid</Badge>;
      case 'open':
        return <Badge variant="secondary">Open</Badge>;
      case 'draft':
        return <Badge variant="outline">Draft</Badge>;
      case 'uncollectible':
        return <Badge variant="destructive">Uncollectible</Badge>;
      case 'void':
        return <Badge variant="outline">Void</Badge>;
      default:
        return <Badge variant="secondary">{status || 'Unknown'}</Badge>;
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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5" />
          Invoices
        </CardTitle>
        <CardDescription>
          View and download your billing history
        </CardDescription>
      </CardHeader>
      <CardContent>
        {invoices.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            No invoices yet
          </p>
        ) : (
          <div className="space-y-2">
            {invoices.map((invoice) => (
              <div key={invoice.id} className="border rounded-lg">
                <div
                  className="flex items-center justify-between p-4 cursor-pointer hover:bg-muted/50"
                  onClick={() => handleToggleExpand(invoice.id)}
                >
                  <div className="flex items-center gap-4">
                    <div>
                      <p className="font-medium">
                        {invoice.number || `Invoice ${invoice.id.slice(-8)}`}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {formatDate(invoice.created)}
                      </p>
                    </div>
                    {getStatusBadge(invoice.status)}
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="font-medium">
                      {formatCurrency(invoice.amount_due, invoice.currency)}
                    </span>
                    {expandedInvoice === invoice.id ? (
                      <ChevronUp className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                </div>

                {expandedInvoice === invoice.id && (
                  <div className="border-t p-4 bg-muted/30">
                    {loadingDetails === invoice.id ? (
                      <div className="space-y-2">
                        <Skeleton className="h-4 w-full" />
                        <Skeleton className="h-4 w-3/4" />
                      </div>
                    ) : invoiceDetails[invoice.id] ? (() => {
                      const details = invoiceDetails[invoice.id]!;
                      return (
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <p className="text-sm font-medium">Line Items</p>
                          {details.line_items.map((item) => (
                            <div key={item.id} className="flex justify-between text-sm">
                              <span className="text-muted-foreground">
                                {item.description || 'Subscription'}
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
                          {invoice.invoice_pdf && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                window.open(invoice.invoice_pdf!, '_blank');
                              }}
                            >
                              <Download className="h-4 w-4 mr-2" />
                              Download PDF
                            </Button>
                          )}
                          {invoice.hosted_invoice_url && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                window.open(invoice.hosted_invoice_url!, '_blank');
                              }}
                            >
                              <ExternalLink className="h-4 w-4 mr-2" />
                              View Online
                            </Button>
                          )}
                        </div>
                      </div>
                      );
                    })() : (
                      <p className="text-sm text-muted-foreground">
                        Failed to load invoice details
                      </p>
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
