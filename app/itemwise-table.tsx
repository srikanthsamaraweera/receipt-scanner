import { Link } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

import BrandingFooter from '@/components/branding-footer';
import { getReceiptItemsWithReceipts } from '@/lib/db';
import type { ReceiptItemWithReceipt } from '@/lib/types';

type ItemRow = ReceiptItemWithReceipt & {
  computedUnitPrice: number | null;
  computedLineTotal: number | null;
};

export default function ItemwiseTableScreen() {
  const [items, setItems] = useState<ReceiptItemWithReceipt[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const rows = useMemo<ItemRow[]>(() => {
    return items.map((item) => {
      const computedLineTotal =
        item.line_total ??
        (item.qty !== null && item.unit_price !== null ? item.qty * item.unit_price : null);
      const computedUnitPrice =
        item.unit_price ??
        (item.qty !== null && item.qty !== 0 && item.line_total !== null
          ? item.line_total / item.qty
          : null);

      return {
        ...item,
        computedUnitPrice,
        computedLineTotal,
      };
    });
  }, [items]);

  const formatCurrency = (value: number | null) =>
    value === null ? '--' : `$${value.toFixed(2)}`;
  const formatQty = (value: number | null) => (value === null ? '--' : String(value));

  useFocusEffect(
    useCallback(() => {
      let isActive = true;
      setIsLoading(true);
      getReceiptItemsWithReceipts()
        .then((data) => {
          if (isActive) {
            setItems(data);
          }
        })
        .catch((error) => {
          console.warn('Failed to load itemwise table', error);
        })
        .finally(() => {
          if (isActive) {
            setIsLoading(false);
          }
        });

      return () => {
        isActive = false;
      };
    }, [])
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Itemwise table</Text>
        <Text style={styles.subtitle}>All items across receipts.</Text>
      </View>

      {isLoading ? (
        <View style={styles.loadingState}>
          <ActivityIndicator size="small" color="#0F766E" />
          <Text style={styles.loadingText}>Loading item table...</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {rows.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>No items yet</Text>
              <Text style={styles.emptyText}>Add receipts to see item-level entries.</Text>
            </View>
          ) : (
            <View style={styles.table}>
              <View style={[styles.tableRow, styles.tableHeaderRow]}>
                <Text style={[styles.tableCell, styles.tableHeaderCell, styles.tableCellDate]}>
                  Date/Time
                </Text>
                <Text style={[styles.tableCell, styles.tableHeaderCell, styles.tableCellName]}>
                  Item
                </Text>
                <Text
                  style={[
                    styles.tableCell,
                    styles.tableHeaderCell,
                    styles.tableCellNumber,
                    styles.tableCellUnitPrice,
                  ]}
                >
                  Unit
                </Text>
                <Text
                  style={[
                    styles.tableCell,
                    styles.tableHeaderCell,
                    styles.tableCellNumber,
                    styles.tableCellQty,
                  ]}
                >
                  Qty
                </Text>
                <Text
                  style={[
                    styles.tableCell,
                    styles.tableHeaderCell,
                    styles.tableCellNumber,
                    styles.tableCellLineTotal,
                  ]}
                >
                  Price
                </Text>
                <Text style={[styles.tableCell, styles.tableHeaderCell, styles.tableCellLink]}>
                  Receipt
                </Text>
              </View>
              {rows.map((item) => (
                <View key={String(item.id)} style={styles.tableRow}>
                  <Text style={[styles.tableCell, styles.tableCellDate]}>
                    {item.purchase_datetime}
                  </Text>
                  <Text style={[styles.tableCell, styles.tableCellName]} numberOfLines={2}>
                    {item.description_raw}
                  </Text>
                  <Text
                    style={[
                      styles.tableCell,
                      styles.tableCellNumber,
                      styles.tableCellUnitPrice,
                    ]}
                  >
                    {formatCurrency(item.computedUnitPrice)}
                  </Text>
                  <Text
                    style={[
                      styles.tableCell,
                      styles.tableCellNumber,
                      styles.tableCellQty,
                    ]}
                  >
                    {formatQty(item.qty)}
                  </Text>
                  <Text
                    style={[
                      styles.tableCell,
                      styles.tableCellNumber,
                      styles.tableCellLineTotal,
                    ]}
                  >
                    {formatCurrency(item.computedLineTotal)}
                  </Text>
                  <View style={[styles.tableCell, styles.tableCellLink]}>
                    <Link href={`/receipt/${item.receipt_id}`} asChild>
                      <Pressable>
                        <Text style={styles.linkText}>View reciept</Text>
                      </Pressable>
                    </Link>
                  </View>
                </View>
              ))}
            </View>
          )}

          <BrandingFooter />
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F6F4F1',
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  header: {
    marginBottom: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#1F2937',
  },
  subtitle: {
    marginTop: 6,
    fontSize: 14,
    color: '#4B5563',
  },
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 10,
    color: '#6B7280',
  },
  scrollContent: {
    paddingBottom: 24,
  },
  emptyState: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    padding: 16,
    alignItems: 'center',
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1F2937',
  },
  emptyText: {
    marginTop: 6,
    color: '#6B7280',
    textAlign: 'center',
  },
  table: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
  },
  tableRow: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  tableHeaderRow: {
    borderTopWidth: 0,
    backgroundColor: '#F3F4F6',
  },
  tableCell: {
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderRightWidth: 1,
    borderRightColor: '#E5E7EB',
    color: '#111827',
    fontSize: 12,
  },
  tableHeaderCell: {
    fontWeight: '700',
    color: '#374151',
  },
  tableCellNumber: {
    textAlign: 'right',
  },
  tableCellDate: {
    flex: 1.6,
  },
  tableCellName: {
    flex: 2,
  },
  tableCellUnitPrice: {
    flex: 1,
  },
  tableCellQty: {
    flex: 0.8,
  },
  tableCellLineTotal: {
    flex: 1,
  },
  tableCellLink: {
    flex: 1.2,
    borderRightWidth: 0,
    justifyContent: 'center',
  },
  linkText: {
    color: '#0F766E',
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
});
