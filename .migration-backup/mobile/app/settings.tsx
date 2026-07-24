import React from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ArrowLeft,
  CaretRight,
  User,
  Info,
  Link,
  Lock,
  Bell,
  Shield,
  UserMinus,
  Question,
  ChatCentered,
  Warning,
  FileText,
  Eye,
  SignOut,
  type Icon,
} from 'phosphor-react-native';
import { router } from 'expo-router';
import { T } from '@/constants/theme';
import { MsAvatar } from '@/components/MsAvatar';
import { useAuth } from '@/contexts/AuthContext';

// ─── Settings row ─────────────────────────────────────────────────────────────

type RowIcon = Icon;

function SettingsRow({
  Icon,
  label,
  onPress,
  chevron = true,
  danger = false,
  badge,
}: {
  Icon?: RowIcon;
  label: string;
  onPress?: () => void;
  chevron?: boolean;
  danger?: boolean;
  badge?: string;
}) {
  const labelColor = danger ? T.ERROR : T.TEXT;
  const iconColor = danger ? T.ERROR : T.TEXT_2;

  return (
    <TouchableOpacity
      style={styles.row}
      onPress={onPress}
      activeOpacity={0.7}
    >
      {Icon && (
        <View style={styles.rowIconWrap}>
          <Icon size={17} color={iconColor} />
        </View>
      )}
      <Text style={[styles.rowLabel, { color: labelColor }]}>{label}</Text>
      {badge && (
        <View style={styles.rowBadge}>
          <Text style={styles.rowBadgeText}>{badge}</Text>
        </View>
      )}
      {chevron && (
        <CaretRight size={15} color={T.TEXT_3} />
      )}
    </TouchableOpacity>
  );
}

// ─── Section header ───────────────────────────────────────────────────────────

function SectionHeader({ title }: { title: string }) {
  return (
    <Text style={styles.sectionTitle}>{title}</Text>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuth();

  const initials = user?.name
    ? user.name.trim().split(' ').map((w: string) => w[0]?.toUpperCase() ?? '').slice(0, 2).join('')
    : 'U';

  const handleSignOut = () => {
    Alert.alert(
      'Log Out',
      'Are you sure you want to log out?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Log Out',
          style: 'destructive',
          onPress: async () => {
            await logout();
            router.replace('/welcome');
          },
        },
      ],
    );
  };

  return (
    <View style={[styles.bg, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          activeOpacity={0.7}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <ArrowLeft size={22} color={T.TEXT} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 40 }]}
      >
        {/* Profile summary */}
        <TouchableOpacity
          style={styles.profileCard}
          activeOpacity={0.8}
          onPress={() => router.push('/edit-profile')}
        >
          <MsAvatar
            size={54}
            initials={initials}
            imageUri={user?.avatarUrl ?? undefined}
          />
          <View style={styles.profileInfo}>
            <Text style={styles.profileName}>{user?.name ?? 'Display Name'}</Text>
            <Text style={styles.profileHandle}>
              @{user?.username ?? 'username'} · Tap to edit profile
            </Text>
          </View>
          <CaretRight size={18} color={T.TEXT_3} />
        </TouchableOpacity>

        {/* Account */}
        <SectionHeader title="Account" />
        <View style={styles.section}>
          <SettingsRow Icon={User}        label="Profile"            onPress={() => router.push('/edit-profile')} />
          <View style={styles.rowDivider} />
          <SettingsRow Icon={Info}        label="Account Information" onPress={() => {}} />
          <View style={styles.rowDivider} />
          <SettingsRow Icon={Link}        label="Linked Accounts"    onPress={() => {}} />
        </View>

        {/* Privacy */}
        <SectionHeader title="Privacy" />
        <View style={styles.section}>
          <SettingsRow Icon={Lock}    label="Privacy Settings"   onPress={() => {}} />
          <View style={styles.rowDivider} />
          <SettingsRow Icon={UserMinus}   label="Blocked Users"      onPress={() => {}} />
          <View style={styles.rowDivider} />
          <SettingsRow Icon={Eye}     label="Content Preferences" onPress={() => {}} />
        </View>

        {/* Notifications */}
        <SectionHeader title="Notifications" />
        <View style={styles.section}>
          <SettingsRow Icon={Bell}    label="Notification Preferences" onPress={() => {}} />
        </View>

        {/* Security */}
        <SectionHeader title="Security" />
        <View style={styles.section}>
          <SettingsRow Icon={Lock}    label="Change Password"          onPress={() => {}} />
          <View style={styles.rowDivider} />
          <SettingsRow Icon={Shield}  label="Two-Factor Authentication" onPress={() => {}} badge="Off" />
          <View style={styles.rowDivider} />
          <SettingsRow Icon={Info}    label="Active Sessions"           onPress={() => {}} />
        </View>

        {/* Support */}
        <SectionHeader title="Support" />
        <View style={styles.section}>
          <SettingsRow Icon={Question}     label="Help Center"        onPress={() => {}} />
          <View style={styles.rowDivider} />
          <SettingsRow Icon={ChatCentered}  label="Contact Support"    onPress={() => {}} />
          <View style={styles.rowDivider} />
          <SettingsRow Icon={Warning}  label="Report a Problem"   onPress={() => {}} />
        </View>

        {/* Legal */}
        <SectionHeader title="Legal" />
        <View style={styles.section}>
          <SettingsRow Icon={FileText}  label="Terms of Service"  onPress={() => {}} />
          <View style={styles.rowDivider} />
          <SettingsRow Icon={Eye}       label="Privacy Policy"    onPress={() => {}} />
          <View style={styles.rowDivider} />
          <SettingsRow Icon={Info}      label="About MeetSweet"   onPress={() => {}} />
        </View>

        {/* Log out */}
        <TouchableOpacity style={styles.logoutBtn} onPress={handleSignOut} activeOpacity={0.8}>
          <SignOut size={17} color={T.ERROR} />
          <Text style={styles.logoutLabel}>Log Out</Text>
        </TouchableOpacity>

        <Text style={styles.version}>MeetSweet v1.0.0</Text>
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  bg: { flex: 1, backgroundColor: T.BG },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: T.BORDER,
    gap: 12,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: T.RADIUS.md,
    backgroundColor: T.SURFACE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontFamily: T.FONT.bold,
    color: T.TEXT,
    letterSpacing: -0.3,
    textAlign: 'center',
  },

  scrollContent: { paddingTop: 8 },

  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 20,
    marginTop: 16,
    marginBottom: 8,
    padding: 16,
    backgroundColor: T.SURFACE,
    borderRadius: T.RADIUS.lg,
    borderWidth: 1,
    borderColor: T.BORDER_2,
    gap: 14,
  },
  profileInfo: { flex: 1 },
  profileName: { fontSize: 15, fontFamily: T.FONT.semibold, color: T.TEXT },
  profileHandle: { fontSize: 12, fontFamily: T.FONT.regular, color: T.TEXT_2, marginTop: 2 },

  sectionTitle: {
    fontSize: 11,
    fontFamily: T.FONT.semibold,
    color: T.TEXT_3,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    paddingHorizontal: 20,
    paddingTop: 28,
    paddingBottom: 8,
  },

  section: {
    marginHorizontal: 20,
    backgroundColor: T.SURFACE,
    borderRadius: T.RADIUS.lg,
    borderWidth: 1,
    borderColor: T.BORDER_2,
    overflow: 'hidden',
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  rowIconWrap: {
    width: 28,
    alignItems: 'center',
  },
  rowLabel: {
    flex: 1,
    fontSize: 14,
    fontFamily: T.FONT.medium,
    color: T.TEXT,
  },
  rowBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: T.RADIUS.xs,
    backgroundColor: T.SURFACE_2,
    borderWidth: 1,
    borderColor: T.BORDER_2,
  },
  rowBadgeText: {
    fontSize: 11,
    fontFamily: T.FONT.medium,
    color: T.TEXT_2,
  },
  rowDivider: {
    height: 1,
    backgroundColor: T.BORDER,
    marginLeft: 56,
  },

  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 20,
    marginTop: 28,
    padding: 16,
    backgroundColor: T.SURFACE,
    borderRadius: T.RADIUS.lg,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.2)',
  },
  logoutLabel: {
    fontSize: 14,
    fontFamily: T.FONT.semibold,
    color: T.ERROR,
  },

  version: {
    fontSize: 12,
    fontFamily: T.FONT.regular,
    color: T.TEXT_3,
    textAlign: 'center',
    marginTop: 24,
  },
});
