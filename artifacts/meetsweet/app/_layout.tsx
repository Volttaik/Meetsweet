import '../global.css';
import React, { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { HeroUINativeProvider } from 'heroui-native';
import { Uniwind } from 'uniwind';

// MeetSweet is a dark-first app — force dark theme so all HeroUI Native
// components (Button, Input, Label, Checkbox, InputOTP…) use the dark palette
// rather than defaulting to the system light theme on web.
Uniwind.setTheme('dark');
import { ErrorBoundary } from '@/components/ErrorBoundary';
import {
  Poppins_400Regular,
  Poppins_500Medium,
  Poppins_600SemiBold,
  Poppins_700Bold,
  useFonts,
} from '@expo-google-fonts/poppins';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

function RootLayoutNav() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
        animationDuration: 280,
        gestureEnabled: true,
        gestureDirection: 'horizontal',
        fullScreenGestureEnabled: true,
      }}
    >
      {/* Onboarding & Auth — new HeroUI Native flow */}
      <Stack.Screen name="index" options={{ gestureEnabled: false }} />
      <Stack.Screen name="welcome" options={{ gestureEnabled: false, animation: 'fade' }} />
      <Stack.Screen name="onboarding" options={{ gestureEnabled: false }} />
      <Stack.Screen name="auth" options={{}} />
      <Stack.Screen name="register" options={{}} />
      <Stack.Screen name="forgot-password" options={{}} />
      <Stack.Screen name="verify-email" options={{}} />
      <Stack.Screen name="success" options={{ gestureEnabled: false, animation: 'fade' }} />

      {/* Legacy screens (kept for compatibility) */}
      <Stack.Screen name="get-started" />
      <Stack.Screen name="create-account" />
      <Stack.Screen name="create-password" />
      <Stack.Screen name="profile-setup" />
      <Stack.Screen name="complete-registration" />
      <Stack.Screen name="verification" />

      {/* Authenticated area */}
      <Stack.Screen name="home" options={{ gestureEnabled: false }} />
      <Stack.Screen name="(tabs)" options={{ gestureEnabled: false }} />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Poppins_400Regular,
    Poppins_500Medium,
    Poppins_600SemiBold,
    Poppins_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <HeroUINativeProvider>
              <KeyboardProvider>
                <RootLayoutNav />
              </KeyboardProvider>
            </HeroUINativeProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
