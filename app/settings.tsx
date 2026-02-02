import { useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, View } from 'react-native';

export const AI_PROVIDER_KEY = 'receipt_scanner_ai_provider';
export const PROVIDERS = {
    GEMINI: 'gemini',
    OPENAI: 'openai',
};

export default function SettingsScreen() {
    const router = useRouter();
    const [provider, setProvider] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        loadProvider();
    }, []);

    const loadProvider = async () => {
        try {
            const stored = await SecureStore.getItemAsync(AI_PROVIDER_KEY);
            // Default to Gemini if not set
            setProvider(stored ?? PROVIDERS.GEMINI);
        } catch (error) {
            console.warn('Failed to load settings', error);
            setProvider(PROVIDERS.GEMINI);
        } finally {
            setIsLoading(false);
        }
    };

    const toggleProvider = async (value: boolean) => {
        const newProvider = value ? PROVIDERS.GEMINI : PROVIDERS.OPENAI;
        setProvider(newProvider);
        try {
            await SecureStore.setItemAsync(AI_PROVIDER_KEY, newProvider);
        } catch (error) {
            console.warn('Failed to save settings', error);
        }
    };

    if (isLoading) {
        return (
            <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#0F766E" />
            </View>
        );
    }

    const isGemini = provider === PROVIDERS.GEMINI;

    return (
        <View style={styles.container}>
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>AI Provider</Text>
                <View style={styles.card}>
                    <View style={styles.row}>
                        <View style={styles.info}>
                            <Text style={styles.label}>Use Google Gemini</Text>
                            <Text style={styles.description}>
                                {isGemini
                                    ? 'Currently using Gemini (Free, Fast)'
                                    : 'Currently using OpenAI (Requires Key)'}
                            </Text>
                        </View>
                        <Switch
                            value={isGemini}
                            onValueChange={toggleProvider}
                            trackColor={{ false: '#767577', true: '#0F766E' }}
                            thumbColor={'#f4f3f4'}
                        />
                    </View>
                </View>
                <Text style={styles.note}>
                    Gemini 2.5 Flash provides fast multimodal receipt parsing. OpenAI requires your own API key.
                </Text>
            </View>

            <Pressable style={styles.doneButton} onPress={() => router.back()}>
                <Text style={styles.doneButtonText}>Done</Text>
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F6F4F1',
        padding: 20,
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    section: {
        marginBottom: 24,
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: '700',
        color: '#1F2937',
        marginBottom: 12,
    },
    card: {
        backgroundColor: '#FFFFFF',
        borderRadius: 12,
        padding: 16,
        borderWidth: 1,
        borderColor: '#E5E7EB',
    },
    row: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    info: {
        flex: 1,
        paddingRight: 16,
    },
    label: {
        fontSize: 16,
        fontWeight: '600',
        color: '#111827',
    },
    description: {
        marginTop: 4,
        fontSize: 14,
        color: '#6B7280',
    },
    note: {
        marginTop: 12,
        fontSize: 14,
        color: '#6B7280',
        lineHeight: 20,
    },
    doneButton: {
        marginTop: 'auto',
        backgroundColor: '#0F766E',
        paddingVertical: 14,
        borderRadius: 12,
        alignItems: 'center',
    },
    doneButtonText: {
        color: '#FFFFFF',
        fontWeight: '600',
        fontSize: 16,
    },
});
