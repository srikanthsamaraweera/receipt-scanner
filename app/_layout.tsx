import 'react-native-reanimated';

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { initDb } from '@/lib/db';

export default function RootLayout() {
  useEffect(() => {
    initDb().catch((error) => {
      console.warn('DB init failed', error);
    });
  }, []);

  return (
    <>
      <Stack
        screenOptions={{
          headerTitleAlign: 'center',
        }}
      >
        <Stack.Screen name="index" options={{ title: 'My Receipts' }} />
        <Stack.Screen name="login" options={{ title: 'Sign In' }} />
        <Stack.Screen name="add-receipt" options={{ title: 'Add Receipt' }} />
        <Stack.Screen name="itemwise-table" options={{ title: 'Itemwise Table' }} />
      </Stack>
      <StatusBar style="auto" />
    </>
  );
}
