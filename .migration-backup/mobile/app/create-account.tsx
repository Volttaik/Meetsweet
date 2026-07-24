import React, { useCallback, useRef, useState } from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MsInput from '@/components/MsInput';
import StepIndicator from '@/components/StepIndicator';
import ScreenTransition from '@/components/ScreenTransition';

type UsernameStatus = 'idle' | 'checking' | 'available' | 'taken';

async function checkUsernameAvailability(username: string): Promise<boolean> {
  try {
    const apiUrl = process.env.EXPO_PUBLIC_API_URL;
    const base = apiUrl ? `${apiUrl.replace(/\/+$/, '')}/api` : '/api';
    const res = await fetch(`${base}/auth/check-username?username=${encodeURIComponent(username)}`);
    if (!res.ok) return true; // default to available on error
    const data: { available: boolean } = await res.json();
    return data.available;
  } catch {
    return true; // default to available on network error
  }
}

function calcAge(dob: string): number {
  // expects MM/DD/YYYY
  const [m, d, y] = dob.split('/').map(Number);
  if (!m || !d || !y || y < 1900) return -1;
  const today = new Date();
  let age = today.getFullYear() - y;
  const monthDiff = today.getMonth() + 1 - m;
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < d)) age--;
  return age;
}

function formatDob(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  let out = digits;
  if (digits.length > 2) out = digits.slice(0, 2) + '/' + digits.slice(2);
  if (digits.length > 4) out = out.slice(0, 5) + '/' + digits.slice(4);
  return out;
}

export default function CreateAccountScreen() {
  const insets = useSafeAreaInsets();

  const [username, setUsername] = useState('');
  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>('idle');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [dob, setDob] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const usernameTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleUsernameChange = useCallback((text: string) => {
    const clean = text.replace(/\s/g, '');
    setUsername(clean);
    setUsernameStatus('idle');
    setErrors((e) => ({ ...e, username: '' }));
    if (usernameTimer.current) clearTimeout(usernameTimer.current);
    if (clean.length >= 3) {
      setUsernameStatus('checking');
      usernameTimer.current = setTimeout(async () => {
        const available = await checkUsernameAvailability(clean);
        setUsernameStatus(available ? 'available' : 'taken');
      }, 700);
    }
  }, []);

  const handleDobChange = (text: string) => {
    setDob(formatDob(text));
    setErrors((e) => ({ ...e, dob: '' }));
  };

  const validate = () => {
    const errs: Record<string, string> = {};
    if (username.length < 3) errs.username = 'At least 3 characters required';
    else if (usernameStatus === 'taken') errs.username = 'Username is already taken';
    else if (usernameStatus === 'checking') errs.username = 'Please wait while we check availability';
    if (!email.includes('@') || !email.includes('.'))
      errs.email = 'Enter a valid email address';
    if (phone.replace(/\D/g, '').length < 10)
      errs.phone = 'Enter a valid phone number';
    if (dob.length < 10) {
      errs.dob = 'Enter your date of birth (MM/DD/YYYY)';
    } else {
      const age = calcAge(dob);
      if (age < 0) errs.dob = 'Enter a valid date';
      else if (age < 18) errs.dob = 'You must be at least 18 years old';
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleContinue = () => {
    if (validate()) {
      router.push({
        pathname: '/create-password',
        params: { username, email, phone, dob },
      });
    }
  };

  const usernameRight =
    usernameStatus === 'checking' ? (
      <Text style={styles.checkingText}>Checking…</Text>
    ) : usernameStatus === 'available' ? (
      <Ionicons name="checkmark-circle" size={20} color="#22C55E" />
    ) : usernameStatus === 'taken' ? (
      <Ionicons name="close-circle" size={20} color="#EF4444" />
    ) : null;

  return (
    <ScreenTransition>
    <LinearGradient colors={['#16081E', '#0D0B1A']} style={styles.gradient}>
      <View
        style={[
          styles.container,
          { paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 16) },
        ]}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => router.back()}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Ionicons name="arrow-back" size={22} color="#FFFFFF" />
          </TouchableOpacity>
          <StepIndicator total={5} current={0} />
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: insets.bottom + (Platform.OS === 'web' ? 34 : 32) },
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.title}>Your Details</Text>
          <Text style={styles.subtitle}>Tell us a bit about yourself.</Text>

          <View style={styles.form}>
            <MsInput
              label="Username"
              placeholder="e.g. sweetuser123"
              value={username}
              onChangeText={handleUsernameChange}
              autoCapitalize="none"
              autoCorrect={false}
              error={errors.username}
              rightElement={usernameRight}
            />
            <MsInput
              label="Email Address"
              placeholder="your@email.com"
              value={email}
              onChangeText={(t) => {
                setEmail(t);
                setErrors((e) => ({ ...e, email: '' }));
              }}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              error={errors.email}
            />
            <MsInput
              label="Phone Number"
              placeholder="+1 234 567 8901"
              value={phone}
              onChangeText={(t) => {
                setPhone(t);
                setErrors((e) => ({ ...e, phone: '' }));
              }}
              keyboardType="phone-pad"
              error={errors.phone}
            />
            <MsInput
              label="Date of Birth"
              placeholder="MM/DD/YYYY"
              value={dob}
              onChangeText={handleDobChange}
              keyboardType="number-pad"
              error={errors.dob}
              rightElement={
                <Ionicons name="calendar-outline" size={18} color="#4A3F72" />
              }
            />
            {!errors.dob && dob.length >= 10 && calcAge(dob) >= 18 && (
              <View style={styles.ageBadge}>
                <Ionicons name="checkmark-circle" size={14} color="#22C55E" />
                <Text style={styles.ageBadgeText}>Age verified ✓</Text>
              </View>
            )}
          </View>

          <TouchableOpacity
            onPress={handleContinue}
            activeOpacity={0.88}
            style={styles.primaryWrap}
          >
            <LinearGradient
              colors={['#FF4473', '#C7155A']}
              style={styles.primaryBtn}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
            >
              <Text style={styles.primaryBtnText}>Continue</Text>
              <Ionicons name="arrow-forward" size={20} color="#FFFFFF" />
            </LinearGradient>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </LinearGradient>
    </ScreenTransition>
  );
}

const styles = StyleSheet.create({
  gradient: { flex: 1 },
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 28,
    marginBottom: 4,
  },
  backBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
    backgroundColor: '#251F40',
  },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 28, paddingTop: 16 },
  title: {
    fontSize: 32,
    fontFamily: 'Poppins_700Bold',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 15,
    fontFamily: 'Poppins_400Regular',
    color: '#9385B8',
    marginBottom: 28,
  },
  form: { gap: 16, marginBottom: 32 },
  checkingText: {
    fontSize: 12,
    fontFamily: 'Poppins_400Regular',
    color: '#9385B8',
  },
  ageBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: -8,
    marginLeft: 4,
  },
  ageBadgeText: {
    fontSize: 12,
    fontFamily: 'Poppins_500Medium',
    color: '#22C55E',
  },
  primaryWrap: { borderRadius: 16, overflow: 'hidden' },
  primaryBtn: {
    height: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontFamily: 'Poppins_600SemiBold',
  },
});
