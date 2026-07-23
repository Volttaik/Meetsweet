import React, { useEffect, useRef, useState } from 'react';
import {
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import OTPInput from '@/components/OTPInput';
import StepIndicator from '@/components/StepIndicator';
import ScreenTransition from '@/components/ScreenTransition';

// Demo code — in production this would come from the server
const DEMO_CODE = '5274';

export default function VerificationScreen() {
  const insets = useSafeAreaInsets();
  const { phone } = useLocalSearchParams<{ phone: string }>();
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [countdown, setCountdown] = useState(60);
  const [canResend, setCanResend] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startTimer = () => {
    setCountdown(60);
    setCanResend(false);
    timerRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timerRef.current!);
          setCanResend(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  useEffect(() => {
    startTimer();
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const handleResend = () => {
    if (!canResend) return;
    setOtp('');
    setError('');
    startTimer();
  };

  const maskedPhone = phone
    ? phone.replace(/\D/g, '').replace(/(\d{3})(\d+)(\d{3})/, '+*** ($1) $2-$3')
    : '+*** *** **78';

  const handleVerify = () => {
    if (otp.length < 4) return;
    if (otp !== DEMO_CODE) {
      setError('Incorrect code. Try ' + DEMO_CODE + ' for demo.');
      return;
    }
    setError('');
    router.replace('/home');
  };

  const isReady = otp.length === 4;

  return (
    <ScreenTransition>
    <LinearGradient colors={['#16081E', '#0D0B1A']} style={styles.gradient}>
      <View
        style={[
          styles.container,
          {
            paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 16),
            paddingBottom: insets.bottom + (Platform.OS === 'web' ? 34 : 28),
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
          <StepIndicator total={5} current={4} />
        </View>

        {/* Content */}
        <View style={styles.content}>
          <LinearGradient
            colors={['#FF447328', '#C7155A14']}
            style={styles.iconCircle}
          >
            <Ionicons name="shield-checkmark-outline" size={46} color="#FF4473" />
          </LinearGradient>

          <Text style={styles.title}>Verify Your Number</Text>
          <Text style={styles.subtitle}>
            We sent a 4-digit code to{'\n'}
            <Text style={styles.phoneHighlight}>{maskedPhone}</Text>
          </Text>

          {/* Demo hint */}
          <View style={styles.demoHint}>
            <Ionicons name="information-circle-outline" size={14} color="#9385B8" />
            <Text style={styles.demoHintText}>Demo code: {DEMO_CODE}</Text>
          </View>

          <OTPInput length={4} value={otp} onChange={(v) => { setOtp(v); setError(''); }} />

          {!!error && (
            <View style={styles.errorRow}>
              <Ionicons name="alert-circle" size={14} color="#EF4444" />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <View style={styles.resendRow}>
            {canResend ? (
              <TouchableOpacity onPress={handleResend} activeOpacity={0.7}>
                <Text style={styles.resendActive}>Resend Code</Text>
              </TouchableOpacity>
            ) : (
              <Text style={styles.resendTimer}>
                Resend in{' '}
                <Text style={styles.resendHighlight}>
                  0:{countdown.toString().padStart(2, '0')}
                </Text>
              </Text>
            )}
          </View>
        </View>

        {/* Verify Button */}
        <TouchableOpacity
          onPress={handleVerify}
          activeOpacity={0.88}
          disabled={!isReady}
          style={styles.primaryWrap}
        >
          <LinearGradient
            colors={isReady ? ['#FF4473', '#C7155A'] : ['#2E2850', '#251F40']}
            style={styles.primaryBtn}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
          >
            <Text style={[styles.primaryBtnText, !isReady && styles.primaryBtnDisabled]}>
              Verify & Continue
            </Text>
            {isReady && <Ionicons name="arrow-forward" size={20} color="#FFFFFF" />}
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </LinearGradient>
    </ScreenTransition>
  );
}

const styles = StyleSheet.create({
  gradient: { flex: 1 },
  container: { flex: 1, paddingHorizontal: 28 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  backBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
    backgroundColor: '#251F40',
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  iconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  title: {
    fontSize: 30,
    fontFamily: 'Poppins_700Bold',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    fontFamily: 'Poppins_400Regular',
    color: '#9385B8',
    textAlign: 'center',
    lineHeight: 24,
  },
  demoHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#1A1628',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#2E2850',
  },
  demoHintText: {
    fontSize: 12,
    fontFamily: 'Poppins_400Regular',
    color: '#9385B8',
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: -4,
  },
  errorText: {
    fontSize: 12,
    fontFamily: 'Poppins_400Regular',
    color: '#EF4444',
  },
  resendRow: { marginTop: 4 },
  resendTimer: {
    fontSize: 14,
    fontFamily: 'Poppins_400Regular',
    color: '#9385B8',
  },
  resendHighlight: {
    color: '#FF4473',
    fontFamily: 'Poppins_600SemiBold',
  },
  phoneHighlight: {
    color: '#FFFFFF',
    fontFamily: 'Poppins_600SemiBold',
  },
  resendActive: {
    fontSize: 14,
    fontFamily: 'Poppins_600SemiBold',
    color: '#FF4473',
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
  primaryBtnDisabled: { color: '#4A3F72' },
});
