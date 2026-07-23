import React, { useEffect, useRef, useState } from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  Button,
  FieldError,
  Input,
  InputOTP,
  Label,
  Spinner,
  TextField,
} from 'heroui-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { ArrowLeft, Eye, EyeOff, Lock, Mail } from 'lucide-react-native';

type Step = 'email' | 'code' | 'new_password' | 'done';

const DEMO_CODE = '1234';

// ─── Shared input row ─────────────────────────────────────────────────────────

function InputRow({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return <View style={styles.inputWrapper}>{icon}{children}</View>;
}

// ─── Step 1: Enter email ──────────────────────────────────────────────────────

function StepEmail({ onNext }: { onNext: (email: string) => void }) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSend = async () => {
    if (!email.includes('@') || !email.includes('.')) { setError('Enter a valid email address'); return; }
    setLoading(true);
    await new Promise((r) => setTimeout(r, 900));
    setLoading(false);
    onNext(email);
  };

  return (
    <View style={step.container}>
      <View style={step.iconWrap}>
        <Mail size={36} color="#FFFFFF" />
      </View>
      <Text style={step.title}>Forgot Password?</Text>
      <Text style={step.subtitle}>
        Enter the email address on your account and we'll send you a reset code.
      </Text>

      <TextField isInvalid={!!error}>
        <Label style={styles.fieldLabel}>Email Address</Label>
        <InputRow icon={<Mail size={18} color="rgba(255,255,255,0.35)" />}>
          <Input
            placeholder="your@email.com"
            keyboardType="email-address"
            autoCapitalize="none"
            value={email}
            onChangeText={(v) => { setEmail(v); setError(''); }}
            style={styles.input}
            placeholderTextColor="rgba(255,255,255,0.2)"
          />
        </InputRow>
        {!!error && <FieldError style={styles.fieldError}>{error}</FieldError>}
      </TextField>

      <Button variant="primary" size="lg" onPress={handleSend} isDisabled={loading} style={styles.primaryBtn}>
        {loading ? <Spinner size="sm" /> : <Button.Label style={styles.btnLabel}>Send Reset Code</Button.Label>}
      </Button>
    </View>
  );
}

// ─── Step 2: Verify code ──────────────────────────────────────────────────────

function StepCode({ email, onNext }: { email: string; onNext: () => void }) {
  const [completed, setCompleted] = useState(false);
  const [enteredCode, setEnteredCode] = useState('');
  const [error, setError] = useState('');
  const [countdown, setCountdown] = useState(60);
  const [canResend, setCanResend] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const shakeX = useSharedValue(0);

  const startTimer = () => {
    setCountdown(60);
    setCanResend(false);
    timerRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) { clearInterval(timerRef.current!); setCanResend(true); return 0; }
        return prev - 1;
      });
    }, 1000);
  };

  useEffect(() => { startTimer(); return () => { if (timerRef.current) clearInterval(timerRef.current); }; }, []);

  const shake = () => {
    shakeX.value = withSequence(
      withTiming(-10, { duration: 55 }), withTiming(10, { duration: 55 }),
      withTiming(-6, { duration: 55 }), withTiming(6, { duration: 55 }),
      withTiming(0, { duration: 55 }),
    );
  };

  const shakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shakeX.value }] }));

  const handleVerify = () => {
    if (!completed) { setError('Enter all 4 digits'); return; }
    if (enteredCode !== DEMO_CODE) { setError(`Incorrect code. Use ${DEMO_CODE} for demo.`); shake(); return; }
    setError('');
    onNext();
  };

  return (
    <View style={step.container}>
      <View style={step.iconWrap}>
        <Text style={step.iconEmoji}>📧</Text>
      </View>
      <Text style={step.title}>Check Your Email</Text>
      <Text style={step.subtitle}>
        We sent a 4-digit code to{'\n'}
        <Text style={step.highlight}>{email}</Text>
      </Text>

      <View style={styles.demoHint}>
        <Text style={styles.demoHintText}>Demo code: {DEMO_CODE}</Text>
      </View>

      <Animated.View style={[styles.otpWrap, shakeStyle]}>
        <InputOTP
          maxLength={4}
          onComplete={(code) => { setEnteredCode(code); setCompleted(true); setError(''); }}
          isInvalid={!!error}
        >
          <InputOTP.Group style={styles.otpGroup}>
            <InputOTP.Slot index={0} style={styles.otpSlot} />
            <InputOTP.Slot index={1} style={styles.otpSlot} />
            <InputOTP.Slot index={2} style={styles.otpSlot} />
            <InputOTP.Slot index={3} style={styles.otpSlot} />
          </InputOTP.Group>
        </InputOTP>
      </Animated.View>

      {!!error && <Text style={styles.errorText}>{error}</Text>}

      <Button variant="primary" size="lg" onPress={handleVerify} style={styles.primaryBtn}>
        <Button.Label style={styles.btnLabel}>Verify Code</Button.Label>
      </Button>

      <TouchableOpacity onPress={() => { if (canResend) { setEnteredCode(''); setCompleted(false); setError(''); startTimer(); } }} style={styles.resendRow}>
        <Text style={[styles.resendText, !canResend && styles.resendDisabled]}>
          {canResend ? 'Resend code' : `Resend in ${countdown}s`}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Step 3: New password ─────────────────────────────────────────────────────

function StepNewPassword({ onNext }: { onNext: () => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = () => {
    const e: Record<string, string> = {};
    if (password.length < 8) e.password = 'At least 8 characters required';
    if (confirm !== password) e.confirm = 'Passwords do not match';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleReset = async () => {
    if (!validate()) return;
    setLoading(true);
    await new Promise((r) => setTimeout(r, 900));
    setLoading(false);
    onNext();
  };

  return (
    <View style={step.container}>
      <View style={step.iconWrap}>
        <Lock size={36} color="#FFFFFF" />
      </View>
      <Text style={step.title}>Create New Password</Text>
      <Text style={step.subtitle}>Choose a strong password of at least 8 characters.</Text>

      <TextField isInvalid={!!errors.password}>
        <Label style={styles.fieldLabel}>New Password</Label>
        <InputRow icon={<Lock size={18} color="rgba(255,255,255,0.35)" />}>
          <Input
            placeholder="••••••••"
            secureTextEntry={!showPw}
            value={password}
            onChangeText={(v) => { setPassword(v); setErrors((e) => ({ ...e, password: '' })); }}
            style={[styles.input, { flex: 1 }]}
            placeholderTextColor="rgba(255,255,255,0.2)"
          />
          <TouchableOpacity onPress={() => setShowPw((v) => !v)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            {showPw ? <EyeOff size={18} color="rgba(255,255,255,0.35)" /> : <Eye size={18} color="rgba(255,255,255,0.35)" />}
          </TouchableOpacity>
        </InputRow>
        {!!errors.password && <FieldError style={styles.fieldError}>{errors.password}</FieldError>}
      </TextField>

      <TextField isInvalid={!!errors.confirm}>
        <Label style={styles.fieldLabel}>Confirm Password</Label>
        <InputRow icon={<Lock size={18} color="rgba(255,255,255,0.35)" />}>
          <Input
            placeholder="••••••••"
            secureTextEntry={!showConfirm}
            value={confirm}
            onChangeText={(v) => { setConfirm(v); setErrors((e) => ({ ...e, confirm: '' })); }}
            style={[styles.input, { flex: 1 }]}
            placeholderTextColor="rgba(255,255,255,0.2)"
          />
          <TouchableOpacity onPress={() => setShowConfirm((v) => !v)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            {showConfirm ? <EyeOff size={18} color="rgba(255,255,255,0.35)" /> : <Eye size={18} color="rgba(255,255,255,0.35)" />}
          </TouchableOpacity>
        </InputRow>
        {!!errors.confirm && <FieldError style={styles.fieldError}>{errors.confirm}</FieldError>}
      </TextField>

      <Button variant="primary" size="lg" onPress={handleReset} isDisabled={loading} style={styles.primaryBtn}>
        {loading ? <Spinner size="sm" /> : <Button.Label style={styles.btnLabel}>Reset Password</Button.Label>}
      </Button>
    </View>
  );
}

// ─── Step 4: Done ─────────────────────────────────────────────────────────────

function StepDone() {
  return (
    <View style={[step.container, { alignItems: 'center' }]}>
      <View style={[step.iconWrap, { width: 88, height: 88, borderRadius: 44 }]}>
        <Text style={{ fontSize: 40 }}>✓</Text>
      </View>
      <Text style={[step.title, { textAlign: 'center' }]}>Password Reset!</Text>
      <Text style={[step.subtitle, { textAlign: 'center' }]}>
        Your password has been reset. Log in with your new password.
      </Text>
      <Button variant="primary" size="lg" onPress={() => router.replace('/auth')} style={styles.primaryBtn}>
        <Button.Label style={styles.btnLabel}>Back to Log In</Button.Label>
      </Button>
    </View>
  );
}

// ─── Step bar ─────────────────────────────────────────────────────────────────

const STEP_KEYS: Step[] = ['email', 'code', 'new_password', 'done'];
const STEP_LABELS = ['Email', 'Verify', 'Password', 'Done'];

function StepBar({ current }: { current: Step }) {
  const idx = STEP_KEYS.indexOf(current);
  return (
    <View style={bar.row}>
      {STEP_LABELS.map((label, i) => (
        <React.Fragment key={label}>
          <View style={bar.step}>
            <View style={[bar.dot, i <= idx && bar.dotActive]}>
              <Text style={[bar.num, i <= idx && bar.numActive]}>
                {i < idx ? '✓' : String(i + 1)}
              </Text>
            </View>
            <Text style={[bar.label, i <= idx && bar.labelActive]}>{label}</Text>
          </View>
          {i < STEP_LABELS.length - 1 && (
            <View style={[bar.connector, i < idx && bar.connectorActive]} />
          )}
        </React.Fragment>
      ))}
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function ForgotPasswordScreen() {
  const insets = useSafeAreaInsets();
  const [currentStep, setCurrentStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const contentOpacity = useSharedValue(1);

  const advance = (to: Step) => {
    contentOpacity.value = withTiming(0, { duration: 140, easing: Easing.in(Easing.cubic) }, () => {
      contentOpacity.value = withTiming(1, { duration: 220, easing: Easing.out(Easing.cubic) });
    });
    setTimeout(() => setCurrentStep(to), 120);
  };

  const contentStyle = useAnimatedStyle(() => ({ opacity: contentOpacity.value }));

  return (
    <View style={styles.bg}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: insets.top + (Platform.OS === 'web' ? 72 : 24),
            paddingBottom: insets.bottom + (Platform.OS === 'web' ? 60 : 48),
          },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {currentStep !== 'done' && (
          <TouchableOpacity onPress={() => router.back()} style={styles.backRow} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <ArrowLeft size={20} color="rgba(255,255,255,0.45)" />
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>
        )}

        <Text style={styles.screenTitle}>Reset Password</Text>
        <StepBar current={currentStep} />

        <Animated.View style={contentStyle}>
          {currentStep === 'email' && (
            <StepEmail onNext={(e) => { setEmail(e); advance('code'); }} />
          )}
          {currentStep === 'code' && (
            <StepCode email={email} onNext={() => advance('new_password')} />
          )}
          {currentStep === 'new_password' && (
            <StepNewPassword onNext={() => advance('done')} />
          )}
          {currentStep === 'done' && <StepDone />}
        </Animated.View>
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  bg: { flex: 1, backgroundColor: '#0A0A0A' },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 24, gap: 28 },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  backText: { fontSize: 15, fontFamily: 'Poppins_500Medium', color: 'rgba(255,255,255,0.45)' },
  screenTitle: { fontSize: 26, fontFamily: 'Poppins_700Bold', color: '#FFFFFF', letterSpacing: -0.4 },

  fieldLabel: { fontFamily: 'Poppins_500Medium', fontSize: 13, color: 'rgba(255,255,255,0.5)', marginBottom: 6 },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111111',
    borderRadius: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    height: 52,
    gap: 10,
  },
  input: { flex: 1, color: '#FFFFFF', fontSize: 15, fontFamily: 'Poppins_400Regular', height: '100%' },
  fieldError: { fontFamily: 'Poppins_400Regular', fontSize: 12, color: '#EF4444', marginTop: 4 },

  primaryBtn: { backgroundColor: '#FFFFFF', borderRadius: 16, height: 56 },
  btnLabel: { fontFamily: 'Poppins_600SemiBold', fontSize: 16, color: '#000000' },

  otpWrap: { alignItems: 'center' },
  otpGroup: { flexDirection: 'row', gap: 12 },
  otpSlot: {
    width: 62,
    height: 70,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: '#111111',
    fontSize: 24,
    fontFamily: 'Poppins_700Bold',
    color: '#FFFFFF',
  },
  errorText: { fontSize: 13, fontFamily: 'Poppins_400Regular', color: '#EF4444', textAlign: 'center' },

  demoHint: { backgroundColor: '#111111', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  demoHintText: { fontSize: 12, fontFamily: 'Poppins_400Regular', color: 'rgba(255,255,255,0.4)', textAlign: 'center' },

  resendRow: { alignItems: 'center' },
  resendText: { fontSize: 14, fontFamily: 'Poppins_600SemiBold', color: '#FFFFFF', paddingVertical: 4 },
  resendDisabled: { color: 'rgba(255,255,255,0.25)' },
});

const step = StyleSheet.create({
  container: { gap: 20 },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  iconEmoji: { fontSize: 32 },
  title: { fontSize: 24, fontFamily: 'Poppins_700Bold', color: '#FFFFFF', letterSpacing: -0.3 },
  subtitle: { fontSize: 14, fontFamily: 'Poppins_400Regular', color: 'rgba(255,255,255,0.45)', lineHeight: 22 },
  highlight: { color: '#FFFFFF', fontFamily: 'Poppins_500Medium' },
});

const bar = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  step: { alignItems: 'center', gap: 4 },
  dot: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: '#111111',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  dotActive: { borderColor: '#FFFFFF', backgroundColor: 'rgba(255,255,255,0.08)' },
  num: { fontSize: 11, fontFamily: 'Poppins_700Bold', color: 'rgba(255,255,255,0.25)' },
  numActive: { color: '#FFFFFF' },
  label: { fontSize: 10, fontFamily: 'Poppins_400Regular', color: 'rgba(255,255,255,0.25)' },
  labelActive: { color: '#FFFFFF', fontFamily: 'Poppins_500Medium' },
  connector: { flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.08)', marginBottom: 14 },
  connectorActive: { backgroundColor: 'rgba(255,255,255,0.4)' },
});
