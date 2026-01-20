import { Link } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useFocusEffect } from '@react-navigation/native';

import BrandingFooter from '@/components/branding-footer';
import { exportReceiptBackup, getReceipts, importReceiptBackup } from '@/lib/db';
import { endOfDay, parseFlexibleDateTime, startOfDay } from '@/lib/date';
import type { Receipt, ReceiptBackup } from '@/lib/types';

export default function HomeScreen() {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filterFrom, setFilterFrom] = useState<Date | null>(null);
  const [filterTo, setFilterTo] = useState<Date | null>(null);
  const [showFromPicker, setShowFromPicker] = useState(false);
  const [showToPicker, setShowToPicker] = useState(false);
  const [isBackupBusy, setIsBackupBusy] = useState(false);

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

  const resolveDocumentPickerModule = (module: {
    getDocumentAsync?: () => Promise<unknown>;
    default?: {
      getDocumentAsync?: () => Promise<unknown>;
    };
  }) => {
    if (module.getDocumentAsync) {
      return module;
    }
    if (module.default?.getDocumentAsync) {
      return module.default;
    }
    return module.default ?? module;
  };

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

  const loadBackupModules = async () => {
    try {
      const [DocumentPickerModule, FileSystemModule, SharingModule] = await Promise.all([
        import('expo-document-picker'),
        import('expo-file-system/legacy'),
        import('expo-sharing'),
      ]);
      return {
        DocumentPicker: resolveDocumentPickerModule(DocumentPickerModule),
        FileSystem: resolveFileSystemModule(FileSystemModule),
        Sharing: resolveSharingModule(SharingModule),
      };
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : 'Backup modules are unavailable.';
      throw new Error(
        `${message} Rebuild the dev client to include expo-document-picker, expo-file-system, and expo-sharing.`
      );
    }
  };

  const parseBackupPayload = (raw: string): ReceiptBackup => {
    const parsed = JSON.parse(raw) as ReceiptBackup;
    if (!parsed || parsed.version !== 1) {
      throw new Error('Unsupported backup format.');
    }
    if (!Array.isArray(parsed.receipts) || !Array.isArray(parsed.items)) {
      throw new Error('Invalid backup data.');
    }
    return parsed;
  };

  const confirmImport = () =>
    new Promise<boolean>((resolve) => {
      if (receipts.length === 0) {
        resolve(true);
        return;
      }
      Alert.alert(
        'Import receipts?',
        'Importing will add receipts to your current list. Continue?',
        [
          { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
          { text: 'Import', onPress: () => resolve(true) },
        ]
      );
    });

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

  const writeBackupFile = async (
    backup: ReceiptBackup,
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
    const data = JSON.stringify(backup);
    const downloadDirectory = await resolveDownloadDirectory(FileSystem);
    if (downloadDirectory && FileSystem.StorageAccessFramework) {
      const fileUri = await FileSystem.StorageAccessFramework.createFileAsync(
        downloadDirectory,
        fileName,
        'application/json'
      );
      await FileSystem.writeAsStringAsync(fileUri, data, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      return { fileUri, shouldShare: false };
    }

    const baseDir = FileSystem.documentDirectory ?? FileSystem.cacheDirectory;
    if (baseDir) {
      const fileUri = `${baseDir}${fileName}`;
      await FileSystem.writeAsStringAsync(fileUri, data, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      return { fileUri, shouldShare: true };
    }

    throw new Error('Unable to access Downloads. Please allow access when prompted.');
  };

  const handleExport = async () => {
    if (isBackupBusy) {
      return;
    }
    setIsBackupBusy(true);
    try {
      const { FileSystem, Sharing } = await loadBackupModules();
      const backup = await exportReceiptBackup();
      const safeTimestamp = backup.exported_at.replace(/[:.]/g, '-');
      const fileName = `receipt-backup-${safeTimestamp}.json`;
      const { fileUri, shouldShare } = await writeBackupFile(
        backup,
        fileName,
        FileSystem
      );

      if (shouldShare && (await Sharing.isAvailableAsync())) {
        await Sharing.shareAsync(fileUri, {
          mimeType: 'application/json',
          dialogTitle: 'Export receipts backup',
        });
      } else {
        Alert.alert('Export complete', `Backup saved.`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to export receipts.';
      Alert.alert('Export failed', message);
    } finally {
      setIsBackupBusy(false);
    }
  };

  const handleImport = async () => {
    if (isBackupBusy) {
      return;
    }
    setIsBackupBusy(true);
    try {
      const { DocumentPicker, FileSystem } = await loadBackupModules();
      const pickResult = await DocumentPicker.getDocumentAsync({
        type: 'application/json',
        copyToCacheDirectory: true,
      });
      if (pickResult.canceled) {
        return;
      }
      const pickedFile = pickResult.assets?.[0];
      if (!pickedFile?.uri) {
        throw new Error('No file selected.');
      }
      const raw = await FileSystem.readAsStringAsync(pickedFile.uri, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      const backup = parseBackupPayload(raw);
      const canImport = await confirmImport();
      if (!canImport) {
        return;
      }
      const result = await importReceiptBackup(backup);
      const updatedReceipts = await getReceipts();
      setReceipts(updatedReceipts);
      Alert.alert(
        'Import complete',
        `Imported ${result.receiptsImported} receipts and ${result.itemsImported} items.`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to import receipts.';
      Alert.alert('Import failed', message);
    } finally {
      setIsBackupBusy(false);
    }
  };

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
      <View style={styles.backupActions}>
        <Pressable
          style={[styles.utilityButton, isBackupBusy && styles.utilityButtonDisabled]}
          onPress={handleExport}
          disabled={isBackupBusy}
        >
          <Text style={styles.utilityButtonText}>Export Data</Text>
        </Pressable>
        <Pressable
          style={[styles.utilityButton, isBackupBusy && styles.utilityButtonDisabled]}
          onPress={handleImport}
          disabled={isBackupBusy}
        >
          <Text style={styles.utilityButtonText}>Import Data</Text>
        </Pressable>
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
          ListFooterComponent={
            <View style={styles.listFooter}>
              <Link href="/itemwise-table" asChild>
                <Pressable style={styles.footerButton}>
                  <Text style={styles.footerButtonText}>Itemwise table</Text>
                </Pressable>
              </Link>
              <BrandingFooter />
            </View>
          }
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
  backupActions: {
    flexDirection: 'row',
    gap: 12,
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
  utilityButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  utilityButtonDisabled: {
    opacity: 0.6,
  },
  utilityButtonText: {
    color: '#111827',
    fontWeight: '600',
  },
  listContent: {
    flexGrow: 1,
    paddingBottom: 24,
  },
  listFooter: {
    gap: 12,
    paddingTop: 12,
    paddingBottom: 12,
  },
  footerButton: {
    borderWidth: 1,
    borderColor: '#0F766E',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  footerButtonText: {
    color: '#0F766E',
    fontWeight: '600',
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
