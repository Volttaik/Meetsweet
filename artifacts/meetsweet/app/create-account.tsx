import React, { useCallback, useRef, useState } from 'react';
import {
  Animated,
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

type UsernameStatus = 'idle' | 'checking' | 'available' | 'taken';

// Simulated availability check (replace with real API call later)
function checkUsernameAvailability(username: string): Promise<boolean> {
  return new Promise((resolve) => {
    const taken = ['admin', 'user', 'meetsweet', 'test', 'root'].includes(
      username.toLowerCase()
    );
    setTimeout(() => resolve(!taken), 900);
  });
}

export default function CreateAccountScreen() {
  const insets = useSafeAreaInsets();

  const [username, setUsername] = useState('');
  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>('idle');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const usernameTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleUsernameChange = useCallback((text: string) => {
    setUsername(text);
    setUsernameStatus('idle');
    setErrors((e) => ({ ...e, username: '' }));
    if (usernameTimer.current) clearTimeout(usernameTimer.current);
    if (text.length >= 3) {
      setUsernameStatus('checking');
      usernameTimer.current = setTimeout(async () => {
        const available = await checkUsernameAvailability(text);
        setUsernameStatus(available ? 'available' : 'taken');
      }, 700);
    }
  }, []);

  const validate = () => {
    const errs: Record<string, string> = {};
    if (username.length < 3) errs.username = 'At least 3 characters required';
    else if (usernameStatus === 'taken') errs.username = 'Username is already taken';
    if (!email.includes('@') || !email.includes('.'))
      errs.email = 'Enter a valid email address';
    if (phone.replace(/\D/g, '').length < 10)
      errs.phone = 'Enter a valid phone number';
    if (password.length < 8) errs.password = 'At least 8 characters required';
    if (password !== confirmPassword) errs.confirmPassword = 'Passwords do not match';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleContinue = () => {
    if (validate()) {
      router.push({ pathname: '/profile-setup', params: { phone } });
    }
  };

  const usernameRight =
    usernameStatus === 'checking' ? (
      <Text style={styles.checkingText}>Checking...</Text>
    ) : usernameStatus === 'available' ? (
      <Ionicons name="checkmark-circle" size={20} color="#22C55E" />
    ) : usernameStatus === 'taken' ? (
      <Ionicons name="close-circle" size={20} color="#EF4444" />
    ) : null;

  return (
    <LinearGradient colors={['#16081E', '#0D0B1A']} style={styles.gradient}>
      <View
        style={[
          styles.container,
          {
            paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 16),
          },
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
          {/* Step indicator */}
          <View style={styles.stepRow}>
            <View style={[styles.stepPill, styles.stepActive]} />
            <View style={styles.stepConnector} />
            <View style={styles.stepPill} />
          </View>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[
            styles.scrollContent,
            {
              paddingBottom:
                insets.bottom + (Platform.OS === 'web' ? 34 : 32),
            },
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.title}>Create Account</Text>
          <Text style={styles.subtitle}>Fill in your details to get started.</Text>

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
              label="Email"
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
              label="Password"
              placeholder="Min. 8 characters"
              value={password}
              onChangeText={(t) => {
                setPassword(t);
                setErrors((e) => ({ ...e, password: '' }));
              }}
              secureTextEntry
              error={errors.password}
            />
            <MsInput
              label="Confirm Password"
              placeholder="Repeat your password"
              value={confirmPassword}
              onChangeText={(t) => {
                setConfirmPassword(t);
                setErrors((e) => ({ ...e, confirmPassword: '' }));
              }}
              secureTextEntry
              error={errors.confirmPassword}
            />
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
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepPill: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#2E2850',
  },
  stepActive: { width: 28, borderRadius: 5, backgroundColor: '#FF4473' },
  stepConnector: { width: 28, height: 2, backgroundColor: '#2E2850' },
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
