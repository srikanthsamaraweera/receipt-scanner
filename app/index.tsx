import { Link } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useFocusEffect } from '@react-navigation/native';

import BrandingFooter from '@/components/branding-footer';
import { getReceipts } from '@/lib/db';
import { endOfDay, parseFlexibleDateTime, startOfDay } from '@/lib/date';
import type { Receipt } from '@/lib/types';

export default function HomeScreen() {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filterFrom, setFilterFrom] = useState<Date | null>(null);
  const [filterTo, setFilterTo] = useState<Date | null>(null);
  const [showFromPicker, setShowFromPicker] = useState(false);
  const [showToPicker, setShowToPicker] = useState(false);

  const formatDateLabel = (date: Date | null) => {
    if (!date) {
      return 'Select date';
    }
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const parseReceiptDateTime = (value: string) => parseFlexibleDateTime(value);

  const filteredReceipts = useMemo(() => {
    if (!filterFrom && !filterTo) {
      return receipts;
    }

    const fromStart = filterFrom ? startOfDay(filterFrom) : null;
    const toEnd = filterTo ? endOfDay(filterTo) : null;

    return receipts.filter((receipt) => {
      const date = parseReceiptDateTime(receipt.purchase_datetime);
      if (!date) {
        return false;
      }
      if (fromStart && date < fromStart) {
        return false;
      }
      if (toEnd && date > toEnd) {
        return false;
      }
      return true;
    });
  }, [filterFrom, filterTo, receipts]);

  useFocusEffect(
    useCallback(() => {
      let isActive = true;
      setIsLoading(true);
      getReceipts()
        .then((data) => {
          if (isActive) {
            setReceipts(data);
          }
        })
        .catch((error) => {
          console.warn('Failed to load receipts', error);
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
        <Text style={styles.title}>My Receipts</Text>
        <Text style={styles.subtitle}>Saved locally on your device.</Text>
      </View>

      <View style={styles.actions}>
        <Link href="/add-receipt" asChild>
          <Pressable style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Add Receipt</Text>
          </Pressable>
        </Link>
        <Link href="/login" asChild>
          <Pressable style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>Sign In</Text>
          </Pressable>
        </Link>
      </View>

      <View style={styles.filterRow}>
        <View style={styles.filterField}>
          <Text style={styles.filterLabel}>From</Text>
          <Pressable style={styles.filterInput} onPress={() => setShowFromPicker(true)}>
            <Text style={[styles.filterValue, !filterFrom && styles.filterPlaceholder]}>
              {formatDateLabel(filterFrom)}
            </Text>
          </Pressable>
          {showFromPicker ? (
            <DateTimePicker
              value={filterFrom ?? new Date()}
              mode="date"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={(event, selectedDate) => {
                if (event.type === 'dismissed') {
                  setShowFromPicker(false);
                  return;
                }
                if (selectedDate) {
                  setFilterFrom(startOfDay(selectedDate));
                  setShowFromPicker(false);
                }
              }}
            />
          ) : null}
        </View>
        <View style={styles.filterField}>
          <Text style={styles.filterLabel}>To</Text>
          <Pressable style={styles.filterInput} onPress={() => setShowToPicker(true)}>
            <Text style={[styles.filterValue, !filterTo && styles.filterPlaceholder]}>
              {formatDateLabel(filterTo)}
            </Text>
          </Pressable>
          {showToPicker ? (
            <DateTimePicker
              value={filterTo ?? new Date()}
              mode="date"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={(event, selectedDate) => {
                if (event.type === 'dismissed') {
                  setShowToPicker(false);
                  return;
                }
                if (selectedDate) {
                  setFilterTo(startOfDay(selectedDate));
                  setShowToPicker(false);
                }
              }}
            />
          ) : null}
        </View>
        <Pressable
          style={styles.filterClearButton}
          onPress={() => {
            setFilterFrom(null);
            setFilterTo(null);
          }}
        >
          <Text style={styles.filterClearText}>Clear</Text>
        </Pressable>
      </View>

      {isLoading ? (
        <View style={styles.loadingState}>
          <ActivityIndicator size="small" color="#0F766E" />
          <Text style={styles.loadingText}>Loading receipts...</Text>
        </View>
      ) : (
        <FlatList
          data={filteredReceipts}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => {
            const displayTotal = item.total ?? item.subtotal;
            return (
              <Link href={`/receipt/${item.id}`} asChild>
                <Pressable style={styles.card} accessibilityRole="button">
                  <View style={styles.cardRow}>
                    <Text style={styles.cardTitle}>{item.merchant_name}</Text>
                    <Text style={styles.cardTotal}>
                      {displayTotal !== null ? `$${displayTotal.toFixed(2)}` : '--'}
                    </Text>
                  </View>
                  <Text style={styles.cardSub}>{item.purchase_datetime}</Text>
                </Pressable>
              </Link>
            );
          }}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>No receipts yet</Text>
              <Text style={styles.emptyText}>Tap Add Receipt to create your first entry.</Text>
            </View>
          }
          ListFooterComponent={<BrandingFooter />}
        />
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
    marginBottom: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#1F2937',
  },
  subtitle: {
    marginTop: 6,
    fontSize: 14,
    color: '#4B5563',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  primaryButton: {
    backgroundColor: '#0F766E',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    marginRight: 12,
  },
  primaryButtonText: {
    color: '#F9FAFB',
    fontWeight: '600',
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: '#0F766E',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
  },
  secondaryButtonText: {
    color: '#0F766E',
    fontWeight: '600',
  },
  listContent: {
    flexGrow: 1,
    paddingBottom: 24,
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
  filterRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 12,
    marginBottom: 12,
  },
  filterField: {
    flex: 1,
  },
  filterLabel: {
    fontSize: 12,
    color: '#6B7280',
    marginBottom: 4,
  },
  filterInput: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    justifyContent: 'center',
  },
  filterValue: {
    color: '#111827',
  },
  filterPlaceholder: {
    color: '#9CA3AF',
  },
  filterClearButton: {
    borderWidth: 1,
    borderColor: '#0F766E',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 2,
  },
  filterClearText: {
    color: '#0F766E',
    fontWeight: '600',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  cardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  cardTotal: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0F766E',
  },
  cardSub: {
    marginTop: 6,
    color: '#6B7280',
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 32,
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
    paddingHorizontal: 20,
  },
});
