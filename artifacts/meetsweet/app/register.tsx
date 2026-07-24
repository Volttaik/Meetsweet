import React, { useRef, useState } from 'react';
import {
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  Button,
  Dialog,
  FieldError,
  Input,
  Label,
  PressableFeedback,
  Spinner,
  TextField,
} from 'heroui-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/contexts/AuthContext';
import { ApiError } from '@/services/api';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import {
  ArrowLeft,
  AtSign,
  Camera,
  Calendar,
  Eye,
  EyeOff,
  Lock,
  Mail,
  Phone,
  User,
} from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';

// ─── Constants ────────────────────────────────────────────────────────────────

const INPUT_BG = '#111111';
const INPUT_BORDER = 'rgba(255,255,255,0.1)';
const INPUT_BORDER_FOCUSED = 'rgba(255,255,255,0.35)';
const INPUT_BORDER_ERROR = '#EF4444';

type StepNum = 1 | 2 | 3;

// ─── Helpers ──────────────────────────────────────────────────────────────────

type Strength = 'weak' | 'fair' | 'good' | 'strong';
const STRENGTH_COLOR: Record<Strength, string> = {
  weak: '#EF4444',
  fair: '#F97316',
  good: '#EAB308',
  strong: '#22C55E',
};

function passwordStrength(pw: string): { level: Strength; score: number; label: string } {
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (score <= 1) return { level: 'weak', score, label: 'Weak' };
  if (score === 2) return { level: 'fair', score, label: 'Fair' };
  if (score === 3) return { level: 'good', score, label: 'Good' };
  return { level: 'strong', score, label: 'Strong' };
}

function calculateAge(dob: string): number {
  // expects MM/DD/YYYY
  const parts = dob.split('/');
  if (parts.length !== 3) return 0;
  const [m, d, y] = parts.map(Number);
  if (!m || !d || !y || y < 1900) return 0;
  const birth = new Date(y, m - 1, d);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

function formatDOB(raw: string): string {
  // auto-insert slashes: MMDDYYYY → MM/DD/YYYY
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 1) return digits;
  if (digits.length <= 4) return `${digits[0]} (${digits.slice(1)}`;
  if (digits.length <= 7) return `${digits[0]} (${digits.slice(1, 4)}) ${digits.slice(4)}`;
  return `${digits[0]} (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
}

// ─── Input row ────────────────────────────────────────────────────────────────

function InputRow({
  icon,
  children,
  isError,
  isFocused,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  isError?: boolean;
  isFocused?: boolean;
}) {
  const borderColor = isError
    ? INPUT_BORDER_ERROR
    : isFocused
    ? INPUT_BORDER_FOCUSED
    : INPUT_BORDER;
  return (
    <View style={[styles.inputWrapper, { borderColor }]}>
      {icon}
      {children}
    </View>
  );
}

// ─── Step bar ─────────────────────────────────────────────────────────────────

const STEP_LABELS = ['About You', 'Password', 'Profile'];

function StepBar({ current }: { current: StepNum }) {
  const idx = current - 1;
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

// ─── Step 1: About You ────────────────────────────────────────────────────────

interface Step1Data {
  name: string;
  username: string;
  email: string;
  phone: string;
  dob: string;
}

function Step1({
  data,
  onChange,
  onNext,
}: {
  data: Step1Data;
  onChange: (d: Partial<Step1Data>) => void;
  onNext: () => void;
}) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [focused, setFocused] = useState<Record<string, boolean>>({});
  const setFoc = (k: string, v: boolean) => setFocused((f) => ({ ...f, [k]: v }));

  const validate = () => {
    const e: Record<string, string> = {};
    if (data.name.trim().length < 2) e.name = 'Enter your full name';
    if (data.username.trim().length < 3) e.username = 'At least 3 characters required';
    else if (!/^[a-z0-9_.]{3,30}$/i.test(data.username.trim())) e.username = 'Letters, numbers, _ and . only';
    if (!data.email.includes('@') || !data.email.includes('.'))
      e.email = 'Enter a valid email address';
    const phoneDigits = data.phone.replace(/\D/g, '');
    if (phoneDigits.length < 11) e.phone = 'Enter a valid 11-digit phone number';
    const age = calculateAge(data.dob);
    if (!data.dob || data.dob.length < 10) e.dob = 'Enter your date of birth (MM/DD/YYYY)';
    else if (age < 18) e.dob = 'You must be at least 18 years old to join';
    else if (age > 120) e.dob = 'Please enter a valid date of birth';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleNext = () => {
    if (validate()) onNext();
  };

  return (
    <View style={styles.stepContainer}>
      <View style={styles.stepHeader}>
        <Text style={styles.stepTitle}>About You</Text>
        <Text style={styles.stepSubtitle}>
          Tell us a little about yourself to get started.
        </Text>
      </View>

      <View style={styles.form}>
        {/* Full Name */}
        <TextField isInvalid={!!errors.name}>
          <Label style={styles.fieldLabel}>Full Name</Label>
          <InputRow
            icon={<User size={20} color={focused.name ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.3)'} />}
            isError={!!errors.name}
            isFocused={focused.name}
          >
            <Input
              placeholder="Jane Smith"
              value={data.name}
              onChangeText={(v) => { onChange({ name: v }); setErrors((e) => ({ ...e, name: '' })); }}
              onFocus={() => setFoc('name', true)}
              onBlur={() => setFoc('name', false)}
              style={styles.input}
              placeholderTextColor="rgba(255,255,255,0.18)"
            />
          </InputRow>
          {!!errors.name && <FieldError style={styles.fieldError}>{errors.name}</FieldError>}
        </TextField>

        {/* Username */}
        <TextField isInvalid={!!errors.username}>
          <Label style={styles.fieldLabel}>Username</Label>
          <InputRow
            icon={<AtSign size={20} color={focused.username ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.3)'} />}
            isError={!!errors.username}
            isFocused={focused.username}
          >
            <Input
              placeholder="yourhandle"
              autoCapitalize="none"
              autoCorrect={false}
              value={data.username}
              onChangeText={(v) => { onChange({ username: v.replace(/\s/g, '') }); setErrors((e) => ({ ...e, username: '' })); }}
              onFocus={() => setFoc('username', true)}
              onBlur={() => setFoc('username', false)}
              style={styles.input}
              placeholderTextColor="rgba(255,255,255,0.18)"
            />
          </InputRow>
          {!!errors.username && <FieldError style={styles.fieldError}>{errors.username}</FieldError>}
        </TextField>

        {/* Email */}
        <TextField isInvalid={!!errors.email}>
          <Label style={styles.fieldLabel}>Email</Label>
          <InputRow
            icon={<Mail size={20} color={focused.email ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.3)'} />}
            isError={!!errors.email}
            isFocused={focused.email}
          >
            <Input
              placeholder="your@email.com"
              keyboardType="email-address"
              autoCapitalize="none"
              value={data.email}
              onChangeText={(v) => { onChange({ email: v }); setErrors((e) => ({ ...e, email: '' })); }}
              onFocus={() => setFoc('email', true)}
              onBlur={() => setFoc('email', false)}
              style={styles.input}
              placeholderTextColor="rgba(255,255,255,0.18)"
            />
          </InputRow>
          {!!errors.email && <FieldError style={styles.fieldError}>{errors.email}</FieldError>}
        </TextField>

        {/* Phone */}
        <TextField isInvalid={!!errors.phone}>
          <Label style={styles.fieldLabel}>Phone Number</Label>
          <InputRow
            icon={<Phone size={20} color={focused.phone ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.3)'} />}
            isError={!!errors.phone}
            isFocused={focused.phone}
          >
            <Input
              placeholder="1 (555) 000-0000"
              keyboardType="phone-pad"
              value={data.phone}
              onChangeText={(v) => {
                onChange({ phone: formatPhone(v) });
                setErrors((e) => ({ ...e, phone: '' }));
              }}
              onFocus={() => setFoc('phone', true)}
              onBlur={() => setFoc('phone', false)}
              style={styles.input}
              placeholderTextColor="rgba(255,255,255,0.18)"
            />
          </InputRow>
          {!!errors.phone && <FieldError style={styles.fieldError}>{errors.phone}</FieldError>}
        </TextField>

        {/* Date of Birth */}
        <TextField isInvalid={!!errors.dob}>
          <Label style={styles.fieldLabel}>Date of Birth</Label>
          <View style={styles.fieldHint}>
            <Text style={styles.fieldHintText}>You must be 18+ to join</Text>
          </View>
          <InputRow
            icon={<Calendar size={20} color={focused.dob ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.3)'} />}
            isError={!!errors.dob}
            isFocused={focused.dob}
          >
            <Input
              placeholder="MM/DD/YYYY"
              keyboardType="numeric"
              value={data.dob}
              onChangeText={(v) => {
                onChange({ dob: formatDOB(v) });
                setErrors((e) => ({ ...e, dob: '' }));
              }}
              onFocus={() => setFoc('dob', true)}
              onBlur={() => setFoc('dob', false)}
              style={styles.input}
              placeholderTextColor="rgba(255,255,255,0.18)"
              maxLength={10}
            />
          </InputRow>
          {!!errors.dob && <FieldError style={styles.fieldError}>{errors.dob}</FieldError>}
        </TextField>
      </View>

      <Button variant="primary" size="lg" onPress={handleNext} style={styles.primaryBtn}>
        <Button.Label style={styles.btnLabel}>Continue</Button.Label>
      </Button>
    </View>
  );
}

// ─── Step 2: Password ─────────────────────────────────────────────────────────

interface Step2Data {
  password: string;
  confirm: string;
}

function Step2({
  data,
  onChange,
  onNext,
  onBack,
}: {
  data: Step2Data;
  onChange: (d: Partial<Step2Data>) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [focused, setFocused] = useState<Record<string, boolean>>({});
  const [showPw, setShowPw] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const setFoc = (k: string, v: boolean) => setFocused((f) => ({ ...f, [k]: v }));

  const strength = data.password ? passwordStrength(data.password) : null;

  const validate = () => {
    const e: Record<string, string> = {};
    if (data.password.length < 8) e.password = 'At least 8 characters required';
    if (strength && strength.level === 'weak') e.password = 'Choose a stronger password';
    if (data.confirm !== data.password) e.confirm = 'Passwords do not match';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  return (
    <View style={styles.stepContainer}>
      <View style={styles.stepHeader}>
        <Text style={styles.stepTitle}>Secure Password</Text>
        <Text style={styles.stepSubtitle}>
          Create a strong password to protect your account.
        </Text>
      </View>

      <View style={styles.form}>
        {/* Password */}
        <TextField isInvalid={!!errors.password}>
          <Label style={styles.fieldLabel}>Password</Label>
          <InputRow
            icon={<Lock size={18} color={focused.password ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.3)'} strokeWidth={1.8} />}
            isError={!!errors.password}
            isFocused={focused.password}
          >
            <Input
              placeholder="••••••••"
              secureTextEntry={!showPw}
              value={data.password}
              onChangeText={(v) => { onChange({ password: v }); setErrors((e) => ({ ...e, password: '' })); }}
              onFocus={() => setFoc('password', true)}
              onBlur={() => setFoc('password', false)}
              style={[styles.input, { flex: 1 }]}
              placeholderTextColor="rgba(255,255,255,0.18)"
            />
            <TouchableOpacity onPress={() => setShowPw((v) => !v)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              {showPw ? <EyeOff size={20} color="rgba(255,255,255,0.35)" /> : <Eye size={20} color="rgba(255,255,255,0.35)" />}
            </TouchableOpacity>
          </InputRow>
          {data.password.length > 0 && strength && (
            <View style={styles.strengthRow}>
              {[0, 1, 2, 3].map((i) => (
                <View
                  key={i}
                  style={[
                    styles.strengthSeg,
                    { backgroundColor: i < strength.score ? STRENGTH_COLOR[strength.level] : 'rgba(255,255,255,0.1)' },
                  ]}
                />
              ))}
              <Text style={[styles.strengthLabel, { color: STRENGTH_COLOR[strength.level] }]}>
                {strength.label}
              </Text>
            </View>
          )}
          {!!errors.password && <FieldError style={styles.fieldError}>{errors.password}</FieldError>}
        </TextField>

        {/* Confirm Password */}
        <TextField isInvalid={!!errors.confirm}>
          <Label style={styles.fieldLabel}>Confirm Password</Label>
          <InputRow
            icon={<Lock size={18} color={focused.confirm ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.3)'} strokeWidth={1.8} />}
            isError={!!errors.confirm}
            isFocused={focused.confirm}
          >
            <Input
              placeholder="••••••••"
              secureTextEntry={!showConfirm}
              value={data.confirm}
              onChangeText={(v) => { onChange({ confirm: v }); setErrors((e) => ({ ...e, confirm: '' })); }}
              onFocus={() => setFoc('confirm', true)}
              onBlur={() => setFoc('confirm', false)}
              style={[styles.input, { flex: 1 }]}
              placeholderTextColor="rgba(255,255,255,0.18)"
            />
            <TouchableOpacity onPress={() => setShowConfirm((v) => !v)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              {showConfirm ? <EyeOff size={20} color="rgba(255,255,255,0.35)" /> : <Eye size={20} color="rgba(255,255,255,0.35)" />}
            </TouchableOpacity>
          </InputRow>
          {!!errors.confirm && <FieldError style={styles.fieldError}>{errors.confirm}</FieldError>}
        </TextField>

        {/* Password hints */}
        <View style={styles.passwordHints}>
          {[
            'At least 8 characters',
            'One uppercase letter',
            'One number',
            'One special character',
          ].map((hint) => (
            <Text key={hint} style={styles.passwordHint}>• {hint}</Text>
          ))}
        </View>
      </View>

      <Button
        variant="primary"
        size="lg"
        onPress={() => { if (validate()) onNext(); }}
        style={styles.primaryBtn}
      >
        <Button.Label style={styles.btnLabel}>Continue</Button.Label>
      </Button>

    </View>
  );
}

// ─── Step 3: Profile ──────────────────────────────────────────────────────────

interface Step3Data {
  bio: string;
  avatarUri: string | null;
}

function Step3({
  data,
  step1Name,
  onChange,
  onNext,
  onBack,
  isLoading,
  serverError,
}: {
  data: Step3Data;
  step1Name: string;
  onChange: (d: Partial<Step3Data>) => void;
  onNext: () => void;
  onBack: () => void;
  isLoading?: boolean;
  serverError?: string;
}) {
  const loading = isLoading ?? false;
  const [focused, setFocused] = useState(false);

  const initials = step1Name
    .trim()
    .split(' ')
    .map((w) => w[0]?.toUpperCase() ?? '')
    .slice(0, 2)
    .join('');

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      onChange({ avatarUri: result.assets[0].uri });
    }
  };

  const handleComplete = () => {
    onNext();
  };

  return (
    <View style={styles.stepContainer}>
      <View style={styles.stepHeader}>
        <Text style={styles.stepTitle}>Your Profile</Text>
        <Text style={styles.stepSubtitle}>
          Add a photo and a short bio so others can get to know you.
        </Text>
      </View>

      {/* Avatar picker */}
      <View style={styles.avatarSection}>
        <TouchableOpacity onPress={pickImage} style={styles.avatarWrap} activeOpacity={0.8}>
          {data.avatarUri ? (
            <Image source={{ uri: data.avatarUri }} style={styles.avatarImg} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Text style={styles.avatarInitials}>{initials || '?'}</Text>
            </View>
          )}
          <View style={styles.avatarBadge}>
            <Camera size={16} color="#000000" />
          </View>
        </TouchableOpacity>
        <Text style={styles.avatarHint}>Tap to add a profile photo</Text>
      </View>

      {/* Bio */}
      <View style={styles.form}>
        <View>
          <Text style={styles.fieldLabel}>Bio</Text>
          <Text style={styles.fieldHintInline}>Tell the community who you are  (optional)</Text>
          <View
            style={[
              styles.bioWrapper,
              { borderColor: focused ? INPUT_BORDER_FOCUSED : INPUT_BORDER },
            ]}
          >
            <Input
              placeholder="A little about yourself…"
              multiline
              numberOfLines={4}
              value={data.bio}
              onChangeText={(v) => onChange({ bio: v })}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              style={styles.bioInput}
              placeholderTextColor="rgba(255,255,255,0.18)"
              maxLength={160}
            />
          </View>
          <Text style={styles.charCount}>{data.bio.length}/160</Text>
        </View>
      </View>

      {!!serverError && (
        <Text style={styles.serverError}>{serverError}</Text>
      )}

      <Button
        variant="primary"
        size="lg"
        onPress={handleComplete}
        isDisabled={loading}
        style={[styles.primaryBtn, loading && styles.primaryBtnLoading]}
      >
        {loading ? (
          <Spinner size="sm" color="#FFFFFF" />
        ) : (
          <Button.Label style={styles.btnLabel}>Complete</Button.Label>
        )}
      </Button>

    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function RegisterScreen() {
  const insets = useSafeAreaInsets();
  const { register } = useAuth();
  const [step, setStep] = useState<StepNum>(1);
  const [submitting, setSubmitting] = useState(false);
  const [registerError, setRegisterError] = useState('');
  const scrollRef = useRef<ScrollView>(null);

  const slideX = useSharedValue(0);
  const opacity = useSharedValue(1);

  const [step1, setStep1] = useState<Step1Data>({ name: '', username: '', email: '', phone: '', dob: '' });
  const [step2, setStep2] = useState<Step2Data>({ password: '', confirm: '' });
  const [step3, setStep3] = useState<Step3Data>({ bio: '', avatarUri: null });

  const transitionTo = (nextStep: StepNum) => {
    const dir = nextStep > step ? 1 : -1;
    opacity.value = withTiming(0, { duration: 160, easing: Easing.in(Easing.cubic) });
    slideX.value = withTiming(-dir * 32, { duration: 160 }, () => {
      runOnJS(setStep)(nextStep);
      runOnJS(() => scrollRef.current?.scrollTo({ y: 0, animated: false }))();
      slideX.value = dir * 32;
      opacity.value = withTiming(1, { duration: 240, easing: Easing.out(Easing.cubic) });
      slideX.value = withTiming(0, { duration: 240, easing: Easing.out(Easing.cubic) });
    });
  };

  const contentStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateX: slideX.value }],
  }));

  const handleStep1Next = () => transitionTo(2);
  const handleStep2Next = () => transitionTo(3);
  const handleStep2Back = () => transitionTo(1);
  const handleStep3Back = () => transitionTo(2);
  const handleStep3Complete = async () => {
    setSubmitting(true);
    setRegisterError('');
    try {
      await register({
        name: step1.name.trim(),
        username: step1.username.trim() || undefined,
        email: step1.email.trim() || undefined,
        phone: step1.phone.trim() || undefined,
        password: step2.password,
        bio: step3.bio.trim() || undefined,
      });
      router.push({ pathname: '/verify-email', params: { email: step1.email.trim() } });
    } catch (err) {
      if (err instanceof ApiError) {
        setRegisterError(err.message);
      } else {
        setRegisterError('Registration failed. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.bg}>
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: insets.top + (Platform.OS === 'web' ? 72 : 24),
            paddingBottom: insets.bottom + 40,
          },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Back to auth */}
        <TouchableOpacity
          onPress={() => (step === 1 ? router.back() : transitionTo((step - 1) as StepNum))}
          style={styles.backBtn}
          hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
        >
          <ArrowLeft size={22} color="#FFFFFF" strokeWidth={2} />
        </TouchableOpacity>

        {/* Screen title */}
        <View style={styles.screenHead}>
          <Text style={styles.screenTitle}>Create Account</Text>
          <Text style={styles.screenSubtitle}>Step {step} of 3</Text>
        </View>

        {/* Step bar */}
        <StepBar current={step} />

        {/* Animated step content */}
        <Animated.View style={[contentStyle, { backgroundColor: '#000000', width: '100%' }]}>
          {step === 1 && (
            <Step1
              data={step1}
              onChange={(d) => setStep1((s) => ({ ...s, ...d }))}
              onNext={handleStep1Next}
            />
          )}
          {step === 2 && (
            <Step2
              data={step2}
              onChange={(d) => setStep2((s) => ({ ...s, ...d }))}
              onNext={handleStep2Next}
              onBack={handleStep2Back}
            />
          )}
          {step === 3 && (
            <Step3
              data={step3}
              step1Name={step1.name}
              onChange={(d) => setStep3((s) => ({ ...s, ...d }))}
              onNext={handleStep3Complete}
              onBack={handleStep3Back}
              isLoading={submitting}
              serverError={registerError}
            />
          )}
        </Animated.View>

        {/* Sign in link */}
        {step === 1 && (
          <View style={styles.signinRow}>
            <Text style={styles.signinText}>Already have an account? </Text>
            <TouchableOpacity onPress={() => router.push('/auth')} activeOpacity={0.7}>
              <Text style={styles.signinLink}>Log In</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  bg: { flex: 1, backgroundColor: '#000000' },
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 24,
    gap: 20,
    flexGrow: 1,
  },

  backBtn: {
    width: 42,
    height: 42,
    borderRadius: 13,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },

  screenHead: { gap: 2 },
  screenTitle: {
    fontSize: 24,
    fontFamily: 'Poppins_700Bold',
    color: '#FFFFFF',
    letterSpacing: -0.4,
  },
  screenSubtitle: {
    fontSize: 14,
    fontFamily: 'Poppins_400Regular',
    color: 'rgba(255,255,255,0.35)',
  },

  // Step content
  stepContainer: { gap: 24, width: '100%' },
  stepHeader: { gap: 6 },
  stepTitle: {
    fontSize: 22,
    fontFamily: 'Poppins_700Bold',
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },
  stepSubtitle: {
    fontSize: 14,
    fontFamily: 'Poppins_400Regular',
    color: 'rgba(255,255,255,0.4)',
    lineHeight: 22,
  },

  form: { gap: 18 },

  fieldLabel: {
    fontFamily: 'Poppins_500Medium',
    fontSize: 15,
    color: 'rgba(255,255,255,0.55)',
    marginBottom: 6,
  },
  fieldHint: { marginTop: -4, marginBottom: 6 },
  fieldHintText: {
    fontSize: 12,
    fontFamily: 'Poppins_400Regular',
    color: 'rgba(255,255,255,0.3)',
  },
  fieldHintInline: {
    fontSize: 12,
    fontFamily: 'Poppins_400Regular',
    color: 'rgba(255,255,255,0.3)',
    marginTop: -4,
    marginBottom: 8,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: INPUT_BG,
    borderRadius: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: INPUT_BORDER,
    height: 44,
    gap: 10,
  },
  input: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 16,
    fontFamily: 'Poppins_400Regular',
    height: '100%',
    backgroundColor: 'transparent',
  },
  fieldError: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 13,
    color: '#EF4444',
    marginTop: 5,
  },

  // Password strength
  strengthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 8,
  },
  strengthSeg: { flex: 1, height: 3, borderRadius: 2 },
  strengthLabel: {
    fontSize: 12,
    fontFamily: 'Poppins_500Medium',
    marginLeft: 4,
  },

  // Password hints
  passwordHints: {
    gap: 4,
    paddingHorizontal: 4,
  },
  passwordHint: {
    fontSize: 13,
    fontFamily: 'Poppins_400Regular',
    color: 'rgba(255,255,255,0.3)',
    lineHeight: 20,
  },

  // Avatar
  avatarSection: {
    alignItems: 'center',
    gap: 12,
  },
  avatarWrap: {
    position: 'relative',
    width: 100,
    height: 100,
  },
  avatarImg: {
    width: 100,
    height: 100,
    borderRadius: 50,
  },
  avatarPlaceholder: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#1A1A1A',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.15)',
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: {
    fontSize: 32,
    fontFamily: 'Poppins_700Bold',
    color: 'rgba(255,255,255,0.5)',
  },
  avatarBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#000000',
  },
  avatarHint: {
    fontSize: 13,
    fontFamily: 'Poppins_400Regular',
    color: 'rgba(255,255,255,0.35)',
  },

  // Bio
  bioWrapper: {
    backgroundColor: INPUT_BG,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: INPUT_BORDER,
    minHeight: 120,
  },
  bioInput: {
    color: '#FFFFFF',
    fontSize: 16,
    fontFamily: 'Poppins_400Regular',
    textAlignVertical: 'top',
    minHeight: 92,
  },
  charCount: {
    fontSize: 12,
    fontFamily: 'Poppins_400Regular',
    color: 'rgba(255,255,255,0.25)',
    textAlign: 'right',
    marginTop: 6,
  },

  // Buttons
  primaryBtn: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    height: 46,
  },
  primaryBtnLoading: {
    backgroundColor: '#111111',
  },
  serverError: {
    fontSize: 13,
    fontFamily: 'Poppins_400Regular',
    color: '#EF4444',
    textAlign: 'center',
    paddingHorizontal: 8,
  },
  btnLabel: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 15,
    color: '#000000',
  },
  backLink: {
    alignSelf: 'center',
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Sign in link
  signinRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 4,
  },
  signinText: {
    fontSize: 14,
    fontFamily: 'Poppins_400Regular',
    color: 'rgba(255,255,255,0.4)',
  },
  signinLink: {
    fontSize: 14,
    fontFamily: 'Poppins_600SemiBold',
    color: '#FFFFFF',
  },
});

// ─── Step bar styles ──────────────────────────────────────────────────────────

const bar = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  step: { alignItems: 'center', gap: 5 },
  dot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#111111',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotActive: {
    borderColor: '#FFFFFF',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  num: {
    fontSize: 12,
    fontFamily: 'Poppins_700Bold',
    color: 'rgba(255,255,255,0.25)',
  },
  numActive: { color: '#FFFFFF' },
  label: {
    fontSize: 11,
    fontFamily: 'Poppins_400Regular',
    color: 'rgba(255,255,255,0.25)',
  },
  labelActive: { color: '#FFFFFF', fontFamily: 'Poppins_500Medium' },
  connector: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
    marginBottom: 18,
  },
  connectorActive: { backgroundColor: 'rgba(255,255,255,0.4)' },
});
