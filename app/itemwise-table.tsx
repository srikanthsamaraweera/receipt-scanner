import DateTimePicker from '@react-native-community/datetimepicker';
import { Link } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

import BrandingFooter from '@/components/branding-footer';
import { parseFlexibleDateTime, startOfDay } from '@/lib/date';
import { getReceiptItemsWithReceipts } from '@/lib/db';
import type { ReceiptItemWithReceipt } from '@/lib/types';

type ItemRow = ReceiptItemWithReceipt & {
  computedUnitPrice: number | null;
  computedLineTotal: number | null;
};

const PAGE_SIZE = 50;

export default function ItemwiseTableScreen() {
  const [items, setItems] = useState<ReceiptItemWithReceipt[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filterFrom, setFilterFrom] = useState<Date | null>(null);
  const [filterTo, setFilterTo] = useState<Date | null>(null);
  const [showFromPicker, setShowFromPicker] = useState(false);
  const [showToPicker, setShowToPicker] = useState(false);
  const [page, setPage] = useState(1);
  const [isExporting, setIsExporting] = useState(false);

  const toDateKey = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const formatDateLabel = (date: Date | null) => (date ? toDateKey(date) : 'Select date');

  const parseReceiptDateTime = (value: string) => parseFlexibleDateTime(value);

  const parseRowDateTime = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const isoMatch = trimmed.match(
      /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/i
    );
    if (isoMatch) {
      const year = Number.parseInt(isoMatch[1], 10);
      const month = Number.parseInt(isoMatch[2], 10) - 1;
      const day = Number.parseInt(isoMatch[3], 10);
      const hour = isoMatch[4] ? Number.parseInt(isoMatch[4], 10) : 0;
      const minute = isoMatch[5] ? Number.parseInt(isoMatch[5], 10) : 0;
      const second = isoMatch[6] ? Number.parseInt(isoMatch[6], 10) : 0;
      const built = new Date(year, month, day, hour, minute, second);
      return Number.isNaN(built.getTime()) ? null : built;
    }
    return parseReceiptDateTime(trimmed);
  };

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

  const filteredRows = useMemo(() => {
    if (!filterFrom && !filterTo) {
      return rows;
    }

    const fromDate = filterFrom ? startOfDay(filterFrom) : null;
    const toDate = filterTo ? startOfDay(filterTo) : null;

    return rows.filter((row) => {
      const rowDate = parseRowDateTime(row.purchase_datetime);
      if (!rowDate) {
        return false;
      }
      if (fromDate && rowDate < fromDate) {
        return false;
      }
      if (toDate && rowDate > toDate) {
        return false;
      }
      return true;
    });
  }, [filterFrom, filterTo, rows]);

  const pageCount = useMemo(
    () => Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE)),
    [filteredRows.length]
  );

  const pageRows = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredRows.slice(start, start + PAGE_SIZE);
  }, [filteredRows, page]);

  useEffect(() => {
    setPage(1);
  }, [filterFrom, filterTo]);

  useEffect(() => {
    setPage((current) => Math.min(Math.max(1, current), pageCount));
  }, [pageCount]);

  const resolveFileSystemModule = (module: { default?: unknown }) =>
    ('default' in module && module.default ? module.default : module);

  const resolveSharingModule = (module: {
    shareAsync?: (...args: never[]) => Promise<unknown>;
    isAvailableAsync?: () => Promise<boolean>;
    default?: {
      shareAsync?: (...args: never[]) => Promise<unknown>;
      isAvailableAsync?: () => Promise<boolean>;
    };
  }) => {
    if (module.shareAsync || module.isAvailableAsync) {
      return module;
    }
    if (module.default?.shareAsync || module.default?.isAvailableAsync) {
      return module.default;
    }
    return module.default ?? module;
  };

  const loadExportModules = async () => {
    try {
      const [FileSystemModule, SharingModule] = await Promise.all([
        import('expo-file-system/legacy'),
        import('expo-sharing'),
      ]);
      return {
        FileSystem: resolveFileSystemModule(FileSystemModule),
        Sharing: resolveSharingModule(SharingModule),
      };
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : 'Export modules are unavailable.';
      throw new Error(
        `${message} Rebuild the dev client to include expo-file-system and expo-sharing.`
      );
    }
  };

  const resolveDownloadDirectory = async (
    FileSystem: {
      StorageAccessFramework?: {
        getUriForDirectoryInRoot: (folderName: string) => string;
        requestDirectoryPermissionsAsync: (
          initialFileUrl?: string | null
        ) => Promise<{ granted: boolean; directoryUri: string }>;
      };
    }
  ) => {
    const saf = FileSystem.StorageAccessFramework;
    if (!saf || Platform.OS !== 'android') {
      return null;
    }
    const downloadUri = saf.getUriForDirectoryInRoot('Download');
    const permissions = await saf.requestDirectoryPermissionsAsync(downloadUri);
    if (!permissions.granted) {
      return null;
    }
    return permissions.directoryUri;
  };

  const writeCsvFile = async (
    csv: string,
    fileName: string,
    FileSystem: {
      documentDirectory?: string | null;
      cacheDirectory?: string | null;
      EncodingType: { UTF8: string };
      writeAsStringAsync: (uri: string, data: string, options: { encoding: string }) => Promise<void>;
      StorageAccessFramework?: {
        requestDirectoryPermissionsAsync: () => Promise<{ granted: boolean; directoryUri: string }>;
        createFileAsync: (directoryUri: string, name: string, mimeType: string) => Promise<string>;
        getUriForDirectoryInRoot: (folderName: string) => string;
      };
    }
  ) => {
    const downloadDirectory = await resolveDownloadDirectory(FileSystem);
    if (downloadDirectory && FileSystem.StorageAccessFramework) {
      const fileUri = await FileSystem.StorageAccessFramework.createFileAsync(
        downloadDirectory,
        fileName,
        'text/csv'
      );
      await FileSystem.writeAsStringAsync(fileUri, csv, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      return { fileUri, shouldShare: false };
    }

    const baseDir = FileSystem.documentDirectory ?? FileSystem.cacheDirectory;
    if (baseDir) {
      const fileUri = `${baseDir}${fileName}`;
      await FileSystem.writeAsStringAsync(fileUri, csv, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      return { fileUri, shouldShare: true };
    }

    throw new Error('Unable to access Downloads. Please allow access when prompted.');
  };

  const escapeCsvValue = (value: string) => `"${value.replace(/"/g, '""')}"`;

  const formatCsvNumber = (value: number | null) =>
    value === null ? '' : value.toFixed(2);

  const buildCsv = (data: ItemRow[]) => {
    const header = [
      'Purchase Date/Time',
      'Item',
      'Unit Price',
      'Quantity',
      'Line Total',
      'Receipt ID',
    ];

    const rows = data.map((row) => [
      row.purchase_datetime,
      row.description_raw,
      formatCsvNumber(row.computedUnitPrice),
      row.qty === null ? '' : String(row.qty),
      formatCsvNumber(row.computedLineTotal),
      String(row.receipt_id),
    ]);

    return [header, ...rows]
      .map((row) => row.map((value) => escapeCsvValue(value)).join(','))
      .join('\n');
  };

  const handleExportCsv = async () => {
    if (isExporting || filteredRows.length === 0) {
      return;
    }
    setIsExporting(true);
    try {
      const { FileSystem, Sharing } = await loadExportModules();
      const csv = buildCsv(filteredRows);
      const safeTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = `itemwise-table-${safeTimestamp}.csv`;
      const { fileUri, shouldShare } = await writeCsvFile(csv, fileName, FileSystem);

      if (shouldShare && (await Sharing.isAvailableAsync())) {
        await Sharing.shareAsync(fileUri, {
          mimeType: 'text/csv',
          dialogTitle: 'Export itemwise table',
        });
      } else {
        Alert.alert('Export complete', 'CSV saved.');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to export CSV.';
      Alert.alert('Export failed', message);
    } finally {
      setIsExporting(false);
    }
  };

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
          <Text style={styles.loadingText}>Loading item table...</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {filteredRows.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>No items yet</Text>
              <Text style={styles.emptyText}>Add receipts to see item-level entries.</Text>
            </View>
          ) : (
            <>
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
                {pageRows.map((item) => (
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
              <View style={styles.pagination}>
                <Pressable
                  style={[styles.pageButton, page === 1 && styles.pageButtonDisabled]}
                  onPress={() => setPage((current) => Math.max(1, current - 1))}
                  disabled={page === 1}
                >
                  <Text
                    style={[styles.pageButtonText, page === 1 && styles.pageButtonTextDisabled]}
                  >
                    Previous
                  </Text>
                </Pressable>
                <Text style={styles.pageInfo}>
                  Page {page} of {pageCount}
                </Text>
                <Pressable
                  style={[styles.pageButton, page === pageCount && styles.pageButtonDisabled]}
                  onPress={() => setPage((current) => Math.min(pageCount, current + 1))}
                  disabled={page === pageCount}
                >
                  <Text
                    style={[
                      styles.pageButtonText,
                      page === pageCount && styles.pageButtonTextDisabled,
                    ]}
                  >
                    Next
                  </Text>
                </Pressable>
              </View>
            </>
          )}

          <Pressable
            style={[
              styles.exportButton,
              (isExporting || filteredRows.length === 0) && styles.exportButtonDisabled,
            ]}
            onPress={handleExportCsv}
            disabled={isExporting || filteredRows.length === 0}
          >
            <Text style={styles.exportButtonText}>
              {isExporting ? 'Exporting...' : 'Export to CSV'}
            </Text>
          </Pressable>

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
  pagination: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
    gap: 12,
  },
  pageButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#0F766E',
    borderRadius: 10,
    paddingVertical: 8,
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  pageButtonDisabled: {
    borderColor: '#CBD5F5',
    backgroundColor: '#F3F4F6',
  },
  pageButtonText: {
    color: '#0F766E',
    fontWeight: '600',
  },
  pageButtonTextDisabled: {
    color: '#9CA3AF',
  },
  pageInfo: {
    color: '#374151',
    fontWeight: '600',
  },
  exportButton: {
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#0F766E',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  exportButtonDisabled: {
    opacity: 0.6,
  },
  exportButtonText: {
    color: '#0F766E',
    fontWeight: '600',
  },
});
