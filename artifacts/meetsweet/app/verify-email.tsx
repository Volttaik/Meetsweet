import React, { useEffect, useRef, useState } from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Button, InputOTP, Spinner } from 'heroui-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { ArrowLeft, Mail } from 'lucide-react-native';
import Svg, { Circle, Path } from 'react-native-svg';

const DEMO_CODE = '123456';

// Envelope illustration
function EmailIllustration() {
  return (
    <Svg width={120} height={120} viewBox="0 0 120 120">
      {/* Envelope background */}
      <Circle cx="60" cy="60" r="55" fill="#FF447312" />
      <Circle cx="60" cy="60" r="42" fill="#FF44730C" />
      {/* Envelope body */}
      <Path
        d="M24 44 C24 40 28 36 32 36 L88 36 C92 36 96 40 96 44 L96 80 C96 84 92 88 88 88 L32 88 C28 88 24 84 24 80 Z"
        fill="#1A1628"
        stroke="#2E2850"
        strokeWidth="1.5"
      />
      {/* Envelope flap */}
      <Path d="M24 44 L60 66 L96 44" stroke="#FF4473" strokeWidth="2" fill="none" strokeLinecap="round" />
      {/* Stars */}
      <Circle cx="22" cy="28" r="3" fill="#FF4473" opacity="0.5" />
      <Circle cx="98" cy="88" r="2.5" fill="#FF4473" opacity="0.4" />
      <Circle cx="104" cy="36" r="2" fill="#9385B8" opacity="0.5" />
    </Svg>
  );
}

export default function VerifyEmailScreen() {
  const insets = useSafeAreaInsets();
  const { email } = useLocalSearchParams<{ email?: string }>();
  const displayEmail = email ?? 'your email';

  const [completed, setCompleted] = useState(false);
  const [enteredCode, setEnteredCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(60);
  const [canResend, setCanResend] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const shakeX = useSharedValue(0);
  const iconScale = useSharedValue(1);

  // Entrance pulse on icon
  useEffect(() => {
    iconScale.value = withSequence(
      withTiming(1.12, { duration: 400, easing: Easing.out(Easing.cubic) }),
      withTiming(1, { duration: 300, easing: Easing.inOut(Easing.cubic) }),
    );
  }, []);

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
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  const shake = () => {
    shakeX.value = withSequence(
      withTiming(-10, { duration: 55 }), withTiming(10, { duration: 55 }),
      withTiming(-8, { duration: 55 }), withTiming(8, { duration: 55 }),
      withTiming(-4, { duration: 55 }), withTiming(0, { duration: 55 }),
    );
  };

  const handleVerify = async () => {
    if (!completed) { setError('Please enter all 6 digits'); return; }
    if (enteredCode !== DEMO_CODE) {
      setError(`Incorrect code. Use ${DEMO_CODE} for demo.`);
      shake();
      return;
    }
    setError('');
    setLoading(true);
    await new Promise((r) => setTimeout(r, 800));
    setLoading(false);
    router.replace('/success');
  };

  const handleResend = () => {
    if (!canResend) return;
    setEnteredCode('');
    setCompleted(false);
    setError('');
    startTimer();
  };

  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: iconScale.value }],
  }));
  const shakeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shakeX.value }],
  }));

  return (
    <LinearGradient colors={['#16081E', '#0D0B1A']} style={styles.gradient}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + (Platform.OS === 'web' ? 72 : 24),
            paddingBottom: insets.bottom + (Platform.OS === 'web' ? 60 : 48),
          },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Back */}
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backRow}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <ArrowLeft size={22} color="#9385B8" />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>

        {/* Illustration */}
        <View style={styles.illustrationWrap}>
          <Animated.View style={iconStyle}>
            <EmailIllustration />
          </Animated.View>
        </View>

        {/* Header text */}
        <View style={styles.headerText}>
          <Text style={styles.title}>Verify Your Email</Text>
          <Text style={styles.subtitle}>
            We sent a 6-digit verification code to{'\n'}
            <Text style={styles.emailHighlight}>{displayEmail}</Text>
          </Text>
        </View>

        {/* Demo hint */}
        <View style={styles.demoHint}>
          <Text style={styles.demoHintText}>Demo code: {DEMO_CODE}</Text>
        </View>

        {/* OTP input */}
        <Animated.View style={[styles.otpWrap, shakeStyle]}>
          <InputOTP
            maxLength={6}
            onComplete={(code) => { setEnteredCode(code); setCompleted(true); setError(''); }}
            isInvalid={!!error}
            style={styles.otp}
          >
            <InputOTP.Group style={styles.otpGroup}>
              <InputOTP.Slot index={0} style={styles.otpSlot} />
              <InputOTP.Slot index={1} style={styles.otpSlot} />
              <InputOTP.Slot index={2} style={styles.otpSlot} />
            </InputOTP.Group>
            <InputOTP.Separator style={styles.otpSep} />
            <InputOTP.Group style={styles.otpGroup}>
              <InputOTP.Slot index={3} style={styles.otpSlot} />
              <InputOTP.Slot index={4} style={styles.otpSlot} />
              <InputOTP.Slot index={5} style={styles.otpSlot} />
            </InputOTP.Group>
          </InputOTP>
        </Animated.View>

        {/* Error */}
        {!!error && (
          <Text style={styles.errorText}>{error}</Text>
        )}

        {/* Verify button */}
        <Button
          variant="primary"
          size="lg"
          onPress={handleVerify}
          isDisabled={loading || !completed}
          style={styles.verifyBtn}
        >
          {loading ? (
            <Spinner size="sm" color="default" />
          ) : (
            <Button.Label style={styles.verifyBtnLabel}>Verify Email</Button.Label>
          )}
        </Button>

        {/* Resend */}
        <View style={styles.resendSection}>
          <Text style={styles.resendPrompt}>Didn't receive the code?</Text>
          <TouchableOpacity onPress={handleResend} disabled={!canResend}>
            <Text style={[styles.resendBtn, !canResend && styles.resendDisabled]}>
              {canResend ? 'Resend code' : `Resend in ${countdown}s`}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradient: { flex: 1 },
  scroll: { flex: 1 },
  content: {
    paddingHorizontal: 24,
    gap: 28,
    alignItems: 'center',
  },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
  },
  backText: {
    fontSize: 15,
    fontFamily: 'Poppins_500Medium',
    color: '#9385B8',
  },
  illustrationWrap: {
    alignItems: 'center',
    marginTop: 8,
  },
  headerText: {
    alignItems: 'center',
    gap: 10,
  },
  title: {
    fontSize: 28,
    fontFamily: 'Poppins_700Bold',
    color: '#FFFFFF',
    letterSpacing: -0.4,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    fontFamily: 'Poppins_400Regular',
    color: '#9385B8',
    textAlign: 'center',
    lineHeight: 24,
  },
  emailHighlight: {
    color: '#FF4473',
    fontFamily: 'Poppins_500Medium',
  },
  demoHint: {
    backgroundColor: '#1A1628',
    borderRadius: 10,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#2E2850',
  },
  demoHintText: {
    fontSize: 12,
    fontFamily: 'Poppins_400Regular',
    color: '#9385B8',
    textAlign: 'center',
  },
  otpWrap: {
    alignItems: 'center',
  },
  otp: {
    alignItems: 'center',
  },
  otpGroup: {
    flexDirection: 'row',
    gap: 10,
  },
  otpSlot: {
    width: 52,
    height: 60,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#2E2850',
    backgroundColor: '#1A1628',
    fontSize: 22,
    fontFamily: 'Poppins_700Bold',
    color: '#FFFFFF',
  },
  otpSep: {
    marginHorizontal: 8,
    backgroundColor: '#2E2850',
    width: 16,
    height: 2,
  },
  errorText: {
    fontSize: 13,
    fontFamily: 'Poppins_400Regular',
    color: '#EF4444',
    textAlign: 'center',
  },
  verifyBtn: {
    backgroundColor: '#FF4473',
    borderRadius: 16,
    height: 56,
    width: '100%',
  },
  verifyBtnLabel: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 16,
    color: '#FFFFFF',
  },
  resendSection: {
    alignItems: 'center',
    gap: 4,
  },
  resendPrompt: {
    fontSize: 13,
    fontFamily: 'Poppins_400Regular',
    color: '#4A3F72',
  },
  resendBtn: {
    fontSize: 14,
    fontFamily: 'Poppins_600SemiBold',
    color: '#FF4473',
    paddingVertical: 4,
  },
  resendDisabled: {
    color: '#4A3F72',
  },
});
