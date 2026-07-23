import React, { useState } from 'react';
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
  Checkbox,
  FieldError,
  Input,
  Label,
  Spinner,
  Tabs,
  TextField,
} from 'heroui-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Eye, EyeOff, AtSign, Lock, Mail, User } from 'lucide-react-native';

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

// ─── Divider ─────────────────────────────────────────────────────────────────

function Divider() {
  return (
    <View style={styles.divider}>
      <View style={styles.dividerLine} />
      <Text style={styles.dividerText}>or continue with</Text>
      <View style={styles.dividerLine} />
    </View>
  );
}

// ─── Social button ────────────────────────────────────────────────────────────

function SocialButton({ label, letter }: { label: string; letter: string }) {
  return (
    <TouchableOpacity style={styles.socialBtn} activeOpacity={0.7}>
      <Text style={styles.socialLetter}>{letter}</Text>
      <Text style={styles.socialLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

// ─── Input wrapper ────────────────────────────────────────────────────────────

function InputRow({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.inputWrapper}>
      {icon}
      {children}
    </View>
  );
}

// ─── Login form ───────────────────────────────────────────────────────────────

function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = () => {
    const e: Record<string, string> = {};
    if (!email.includes('@') || !email.includes('.')) e.email = 'Enter a valid email address';
    if (password.length < 6) e.password = 'Password must be at least 6 characters';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleLogin = async () => {
    if (!validate()) return;
    setLoading(true);
    await new Promise((r) => setTimeout(r, 1000));
    setLoading(false);
    router.replace('/home');
  };

  return (
    <View style={styles.form}>
      <TextField isInvalid={!!errors.email}>
        <Label style={styles.fieldLabel}>Email</Label>
        <InputRow icon={<Mail size={18} color="rgba(255,255,255,0.35)" />}>
          <Input
            placeholder="your@email.com"
            keyboardType="email-address"
            autoCapitalize="none"
            value={email}
            onChangeText={(v) => { setEmail(v); setErrors((e) => ({ ...e, email: '' })); }}
            style={styles.input}
            placeholderTextColor="rgba(255,255,255,0.2)"
          />
        </InputRow>
        {!!errors.email && <FieldError style={styles.fieldError}>{errors.email}</FieldError>}
      </TextField>

      <TextField isInvalid={!!errors.password}>
        <Label style={styles.fieldLabel}>Password</Label>
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
            {showPw
              ? <EyeOff size={18} color="rgba(255,255,255,0.35)" />
              : <Eye size={18} color="rgba(255,255,255,0.35)" />}
          </TouchableOpacity>
        </InputRow>
        {!!errors.password && <FieldError style={styles.fieldError}>{errors.password}</FieldError>}
      </TextField>

      {/* Remember me + Forgot */}
      <View style={styles.loginMeta}>
        <TouchableOpacity style={styles.checkRow} onPress={() => setRememberMe((v) => !v)} activeOpacity={0.7}>
          <Checkbox isSelected={rememberMe} onSelectedChange={setRememberMe} />
          <Text style={styles.checkLabel}>Remember me</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.push('/forgot-password')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.forgotText}>Forgot password?</Text>
        </TouchableOpacity>
      </View>

      <Button
        variant="primary"
        size="lg"
        onPress={handleLogin}
        isDisabled={loading}
        style={styles.submitBtn}
      >
        {loading
          ? <Spinner size="sm" />
          : <Button.Label style={styles.submitBtnLabel}>Log In</Button.Label>}
      </Button>

      <Divider />

      <View style={styles.socialGroup}>
        <SocialButton label="Continue with Google" letter="G" />
        {Platform.OS === 'ios' && <SocialButton label="Continue with Apple" letter="" />}
      </View>
    </View>
  );
}

// ─── Register form ────────────────────────────────────────────────────────────

type UsernameStatus = 'idle' | 'checking' | 'available' | 'taken';
const TAKEN = ['admin', 'meetsweet', 'root', 'user', 'test'];

function RegisterForm() {
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>('idle');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [acceptPrivacy, setAcceptPrivacy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const usernameTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const strength = password ? passwordStrength(password) : null;

  const handleUsernameChange = (text: string) => {
    const clean = text.replace(/\s/g, '').toLowerCase();
    setUsername(clean);
    setUsernameStatus('idle');
    setErrors((e) => ({ ...e, username: '' }));
    if (usernameTimer.current) clearTimeout(usernameTimer.current);
    if (clean.length >= 3) {
      setUsernameStatus('checking');
      usernameTimer.current = setTimeout(() => {
        setUsernameStatus(TAKEN.includes(clean) ? 'taken' : 'available');
      }, 700);
    }
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (name.trim().length < 2) e.name = 'Enter your full name';
    if (username.length < 3) e.username = 'At least 3 characters required';
    else if (usernameStatus === 'taken') e.username = 'Username already taken';
    else if (usernameStatus === 'checking') e.username = 'Still checking availability…';
    if (!email.includes('@') || !email.includes('.')) e.email = 'Enter a valid email address';
    if (password.length < 8) e.password = 'At least 8 characters required';
    if (confirm !== password) e.confirm = 'Passwords do not match';
    if (!acceptTerms) e.terms = 'Accept the Terms of Service to continue';
    if (!acceptPrivacy) e.privacy = 'Accept the Privacy Policy to continue';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleRegister = async () => {
    if (!validate()) return;
    setLoading(true);
    await new Promise((r) => setTimeout(r, 1000));
    setLoading(false);
    router.push({ pathname: '/verify-email', params: { email } });
  };

  return (
    <View style={styles.form}>
      {/* Full name */}
      <TextField isInvalid={!!errors.name}>
        <Label style={styles.fieldLabel}>Full Name</Label>
        <InputRow icon={<User size={18} color="rgba(255,255,255,0.35)" />}>
          <Input
            placeholder="Jane Smith"
            value={name}
            onChangeText={(v) => { setName(v); setErrors((e) => ({ ...e, name: '' })); }}
            style={styles.input}
            placeholderTextColor="rgba(255,255,255,0.2)"
          />
        </InputRow>
        {!!errors.name && <FieldError style={styles.fieldError}>{errors.name}</FieldError>}
      </TextField>

      {/* Username */}
      <TextField isInvalid={!!errors.username}>
        <Label style={styles.fieldLabel}>Username</Label>
        <InputRow icon={<AtSign size={18} color="rgba(255,255,255,0.35)" />}>
          <Input
            placeholder="janesmith"
            autoCapitalize="none"
            value={username}
            onChangeText={handleUsernameChange}
            style={[styles.input, { flex: 1 }]}
            placeholderTextColor="rgba(255,255,255,0.2)"
          />
          {usernameStatus === 'checking' && <Spinner size="sm" />}
          {usernameStatus === 'available' && <Text style={styles.statusOk}>✓</Text>}
          {usernameStatus === 'taken' && <Text style={styles.statusErr}>✗</Text>}
        </InputRow>
        {!!errors.username && <FieldError style={styles.fieldError}>{errors.username}</FieldError>}
      </TextField>

      {/* Email */}
      <TextField isInvalid={!!errors.email}>
        <Label style={styles.fieldLabel}>Email</Label>
        <InputRow icon={<Mail size={18} color="rgba(255,255,255,0.35)" />}>
          <Input
            placeholder="your@email.com"
            keyboardType="email-address"
            autoCapitalize="none"
            value={email}
            onChangeText={(v) => { setEmail(v); setErrors((e) => ({ ...e, email: '' })); }}
            style={styles.input}
            placeholderTextColor="rgba(255,255,255,0.2)"
          />
        </InputRow>
        {!!errors.email && <FieldError style={styles.fieldError}>{errors.email}</FieldError>}
      </TextField>

      {/* Password */}
      <TextField isInvalid={!!errors.password}>
        <Label style={styles.fieldLabel}>Password</Label>
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
        {password.length > 0 && strength && (
          <View style={styles.strengthRow}>
            {[0, 1, 2, 3].map((i) => (
              <View
                key={i}
                style={[styles.strengthSeg, { backgroundColor: i < strength.score ? STRENGTH_COLOR[strength.level] : 'rgba(255,255,255,0.1)' }]}
              />
            ))}
            <Text style={[styles.strengthLabel, { color: STRENGTH_COLOR[strength.level] }]}>{strength.label}</Text>
          </View>
        )}
        {!!errors.password && <FieldError style={styles.fieldError}>{errors.password}</FieldError>}
      </TextField>

      {/* Confirm password */}
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

      {/* Agreements */}
      <View style={styles.agreementGroup}>
        <TouchableOpacity style={styles.checkRow} onPress={() => setAcceptTerms((v) => !v)} activeOpacity={0.7}>
          <Checkbox isSelected={acceptTerms} onSelectedChange={setAcceptTerms} isInvalid={!!errors.terms} />
          <Text style={styles.checkLabel}>
            I accept the <Text style={styles.checkLink}>Terms of Service</Text>
          </Text>
        </TouchableOpacity>
        {!!errors.terms && <Text style={styles.inlineErr}>{errors.terms}</Text>}

        <TouchableOpacity style={styles.checkRow} onPress={() => setAcceptPrivacy((v) => !v)} activeOpacity={0.7}>
          <Checkbox isSelected={acceptPrivacy} onSelectedChange={setAcceptPrivacy} isInvalid={!!errors.privacy} />
          <Text style={styles.checkLabel}>
            I accept the <Text style={styles.checkLink}>Privacy Policy</Text>
          </Text>
        </TouchableOpacity>
        {!!errors.privacy && <Text style={styles.inlineErr}>{errors.privacy}</Text>}
      </View>

      <Button
        variant="primary"
        size="lg"
        onPress={handleRegister}
        isDisabled={loading}
        style={styles.submitBtn}
      >
        {loading
          ? <Spinner size="sm" />
          : <Button.Label style={styles.submitBtnLabel}>Create Account</Button.Label>}
      </Button>

      <Divider />

      <View style={styles.socialGroup}>
        <SocialButton label="Continue with Google" letter="G" />
        {Platform.OS === 'ios' && <SocialButton label="Continue with Apple" letter="" />}
      </View>
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

type Tab = 'login' | 'register';

export default function AuthScreen() {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('login');
  const contentOpacity = useSharedValue(1);

  const handleTabChange = (value: string) => {
    contentOpacity.value = withTiming(0, { duration: 90 }, () => {
      contentOpacity.value = withTiming(1, { duration: 200, easing: Easing.out(Easing.cubic) });
    });
    setTimeout(() => setTab(value as Tab), 75);
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
        {/* Back */}
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>

        {/* Logo — no border, no background */}
        <View style={styles.authHeader}>
          <Image
            source={require('../assets/images/logo.png')}
            style={styles.logo}
            resizeMode="contain"
            tintColor="#FFFFFF"
          />
          <Text style={styles.authTitle}>
            {tab === 'login' ? 'Welcome back' : 'Join MeetSweet'}
          </Text>
          <Text style={styles.authSubtitle}>
            {tab === 'login'
              ? 'Sign in to your account to continue'
              : 'Create your account to get started'}
          </Text>
        </View>

        {/* Tab selector */}
        <Tabs value={tab} onValueChange={handleTabChange} style={styles.tabs}>
          <Tabs.List style={styles.tabsList}>
            <Tabs.ScrollView>
              <Tabs.Indicator style={styles.tabIndicator} />
              <Tabs.Trigger value="login" style={styles.tabTrigger}>
                <Tabs.Label style={tab === 'login' ? styles.tabLabelActive : styles.tabLabel}>
                  Log In
                </Tabs.Label>
              </Tabs.Trigger>
              <Tabs.Trigger value="register" style={styles.tabTrigger}>
                <Tabs.Label style={tab === 'register' ? styles.tabLabelActive : styles.tabLabel}>
                  Register
                </Tabs.Label>
              </Tabs.Trigger>
            </Tabs.ScrollView>
          </Tabs.List>
        </Tabs>

        <Animated.View style={contentStyle}>
          {tab === 'login' ? <LoginForm /> : <RegisterForm />}
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const INPUT_BG = '#111111';
const INPUT_BORDER = 'rgba(255,255,255,0.1)';

const styles = StyleSheet.create({
  bg: { flex: 1, backgroundColor: '#0A0A0A' },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 24, gap: 24 },

  backBtn: { alignSelf: 'flex-start' },
  backText: { fontSize: 15, fontFamily: 'Poppins_500Medium', color: 'rgba(255,255,255,0.45)' },

  authHeader: { alignItems: 'center', gap: 8 },
  logo: { width: 44, height: 44 },
  authTitle: { fontSize: 28, fontFamily: 'Poppins_700Bold', color: '#FFFFFF', letterSpacing: -0.5, marginTop: 6 },
  authSubtitle: { fontSize: 14, fontFamily: 'Poppins_400Regular', color: 'rgba(255,255,255,0.4)', textAlign: 'center' },

  // Tabs
  tabs: { backgroundColor: 'transparent' },
  tabsList: { backgroundColor: '#111111', borderRadius: 14, padding: 4, borderWidth: 0 },
  tabIndicator: { backgroundColor: '#FFFFFF', borderRadius: 10 },
  tabTrigger: { flex: 1, paddingVertical: 10 },
  tabLabel: { fontFamily: 'Poppins_500Medium', fontSize: 15, color: 'rgba(255,255,255,0.4)' },
  tabLabelActive: { fontFamily: 'Poppins_600SemiBold', fontSize: 15, color: '#000000' },

  // Form
  form: { gap: 16 },
  fieldLabel: { fontFamily: 'Poppins_500Medium', fontSize: 13, color: 'rgba(255,255,255,0.5)', marginBottom: 6 },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: INPUT_BG,
    borderRadius: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: INPUT_BORDER,
    height: 52,
    gap: 10,
  },
  input: { flex: 1, color: '#FFFFFF', fontSize: 15, fontFamily: 'Poppins_400Regular', height: '100%' },
  fieldError: { fontFamily: 'Poppins_400Regular', fontSize: 12, color: '#EF4444', marginTop: 4 },

  // Login meta
  loginMeta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: -4 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  checkLabel: { fontSize: 13, fontFamily: 'Poppins_400Regular', color: 'rgba(255,255,255,0.5)' },
  checkLink: { color: '#FFFFFF', fontFamily: 'Poppins_500Medium' },
  forgotText: { fontSize: 13, fontFamily: 'Poppins_500Medium', color: '#FFFFFF' },

  // Strength bar
  strengthRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  strengthSeg: { flex: 1, height: 3, borderRadius: 2 },
  strengthLabel: { fontSize: 11, fontFamily: 'Poppins_500Medium', marginLeft: 4 },

  // Agreements
  agreementGroup: { gap: 10 },
  inlineErr: { fontSize: 12, fontFamily: 'Poppins_400Regular', color: '#EF4444', marginLeft: 30, marginTop: -4 },

  // Submit
  submitBtn: { backgroundColor: '#FFFFFF', borderRadius: 16, height: 56, marginTop: 4 },
  submitBtnLabel: { fontFamily: 'Poppins_600SemiBold', fontSize: 16, color: '#000000' },

  // Divider
  divider: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dividerLine: { flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.08)' },
  dividerText: { fontSize: 12, fontFamily: 'Poppins_400Regular', color: 'rgba(255,255,255,0.25)' },

  // Social
  socialGroup: { gap: 12 },
  socialBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderRadius: 14,
    height: 52,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: '#111111',
  },
  socialLetter: { fontSize: 16, fontFamily: 'Poppins_700Bold', color: '#FFFFFF', width: 20, textAlign: 'center' },
  socialLabel: { fontSize: 15, fontFamily: 'Poppins_500Medium', color: '#FFFFFF' },

  // Username status
  statusOk: { fontSize: 16, color: '#22C55E', fontFamily: 'Poppins_700Bold' },
  statusErr: { fontSize: 16, color: '#EF4444', fontFamily: 'Poppins_700Bold' },
});
