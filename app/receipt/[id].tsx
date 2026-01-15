import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import BrandingFooter from '@/components/branding-footer';
import { getReceiptById, getReceiptItems } from '@/lib/db';
import type { Receipt, ReceiptItem } from '@/lib/types';

export default function ReceiptDetailScreen() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const receiptId = useMemo(() => {
    const rawId = Array.isArray(params.id) ? params.id[0] : params.id;
    if (!rawId) {
      return null;
    }
    const parsed = Number.parseInt(rawId, 10);
    return Number.isNaN(parsed) ? null : parsed;
  }, [params.id]);

  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [items, setItems] = useState<ReceiptItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let isActive = true;

    if (receiptId === null) {
      setErrorMessage('Invalid receipt id.');
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    Promise.all([getReceiptById(receiptId), getReceiptItems(receiptId)])
      .then(([receiptData, itemData]) => {
        if (!isActive) {
          return;
        }
        setReceipt(receiptData);
        setItems(itemData);
        if (!receiptData) {
          setErrorMessage('Receipt not found.');
        }
      })
      .catch((error) => {
        if (!isActive) {
          return;
        }
        const message = error instanceof Error ? error.message : 'Failed to load receipt.';
        setErrorMessage(message);
      })
      .finally(() => {
        if (isActive) {
          setIsLoading(false);
        }
      });

    return () => {
      isActive = false;
    };
  }, [receiptId]);

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="small" color="#0F766E" />
        <Text style={styles.loadingText}>Loading receipt...</Text>
      </View>
    );
  }

  if (errorMessage) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{errorMessage}</Text>
      </View>
    );
  }

  if (!receipt) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Receipt not found.</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{receipt.merchant_name}</Text>
        <Text style={styles.subtitle}>{receipt.purchase_datetime}</Text>
      </View>

      <View style={styles.summaryCard}>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Subtotal</Text>
          <Text style={styles.summaryValue}>
            {receipt.subtotal !== null ? `$${receipt.subtotal.toFixed(2)}` : '--'}
          </Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Tax</Text>
          <Text style={styles.summaryValue}>
            {receipt.tax !== null ? `$${receipt.tax.toFixed(2)}` : '--'}
          </Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Total</Text>
          <Text style={styles.summaryTotal}>
            {receipt.total !== null ? `$${receipt.total.toFixed(2)}` : '--'}
          </Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Items</Text>
        {items.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No items recorded for this receipt.</Text>
          </View>
        ) : (
          <View style={styles.table}>
            <View style={[styles.tableRow, styles.tableHeaderRow]}>
              <Text style={[styles.tableCell, styles.tableHeaderCell, styles.tableCellName]}>
                Item
              </Text>
              <Text style={[styles.tableCell, styles.tableHeaderCell, styles.tableCellQty]}>
                Qty
              </Text>
              <Text style={[styles.tableCell, styles.tableHeaderCell, styles.tableCellPrice]}>
                Unit Price
              </Text>
              <Text style={[styles.tableCell, styles.tableHeaderCell, styles.tableCellLineTotal]}>
                Line Total
              </Text>
            </View>
            {items.map((item) => (
              <View key={item.id} style={styles.tableRow}>
                <Text style={[styles.tableCell, styles.tableCellName]}>
                  {item.description_raw}
                </Text>
                <Text style={[styles.tableCell, styles.tableCellQty]}>
                  {item.qty !== null ? item.qty : '--'}
                </Text>
                <Text style={[styles.tableCell, styles.tableCellPrice]}>
                  {item.unit_price !== null ? item.unit_price.toFixed(2) : '--'}
                </Text>
                <Text style={[styles.tableCell, styles.tableCellLineTotal]}>
                  {item.line_total !== null ? item.line_total.toFixed(2) : '--'}
                </Text>
              </View>
            ))}
          </View>
        )}
      </View>

      <BrandingFooter />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    paddingBottom: 32,
    backgroundColor: '#F6F4F1',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#F6F4F1',
  },
  loadingText: {
    marginTop: 10,
    color: '#6B7280',
  },
  errorText: {
    color: '#B91C1C',
    fontWeight: '600',
    textAlign: 'center',
  },
  header: {
    marginBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#1F2937',
  },
  subtitle: {
    marginTop: 6,
    color: '#6B7280',
  },
  summaryCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    padding: 16,
    marginBottom: 18,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  summaryLabel: {
    color: '#6B7280',
  },
  summaryValue: {
    color: '#111827',
    fontWeight: '600',
  },
  summaryTotal: {
    color: '#0F766E',
    fontWeight: '700',
  },
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1F2937',
    marginBottom: 8,
  },
  emptyState: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    padding: 16,
    alignItems: 'center',
  },
  emptyText: {
    color: '#6B7280',
  },
  table: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 8,
    overflow: 'hidden',
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  tableHeaderRow: {
    backgroundColor: '#F3F4F6',
    borderTopWidth: 0,
  },
  tableCell: {
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRightWidth: 1,
    borderRightColor: '#E5E7EB',
    color: '#111827',
  },
  tableHeaderCell: {
    fontWeight: '700',
    color: '#374151',
  },
  tableCellName: {
    flex: 2,
  },
  tableCellQty: {
    flex: 1,
    textAlign: 'right',
  },
  tableCellPrice: {
    flex: 1.1,
    textAlign: 'right',
  },
  tableCellLineTotal: {
    flex: 1.2,
    textAlign: 'right',
    borderRightWidth: 0,
  },
});
