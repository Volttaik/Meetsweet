import React, { useCallback, useEffect, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Spinner } from 'heroui-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, BellOff, Check } from 'lucide-react-native';
import { router } from 'expo-router';
import { T } from '@/constants/theme';
import { MsAvatar } from '@/components/MsAvatar';
import { MsEmptyState } from '@/components/MsEmptyState';
import {
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type Notification,
} from '@/services/notifications';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function groupNotifications(items: Notification[]) {
  const today: Notification[] = [];
  const yesterday: Notification[] = [];
  const earlier: Notification[] = [];

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfToday.getDate() - 1);

  for (const n of items) {
    const d = new Date(n.createdAt);
    if (d >= startOfToday) today.push(n);
    else if (d >= startOfYesterday) yesterday.push(n);
    else earlier.push(n);
  }

  return { today, yesterday, earlier };
}

function initials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0]?.toUpperCase() ?? '')
    .slice(0, 2)
    .join('');
}

// ─── Notification row ─────────────────────────────────────────────────────────

function NotifRow({
  item,
  onPress,
}: {
  item: Notification;
  onPress: (n: Notification) => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.notifRow, !item.isRead && styles.notifRowUnread]}
      onPress={() => onPress(item)}
      activeOpacity={0.7}
    >
      <MsAvatar
        size={44}
        initials={item.actor ? initials(item.actor.name) : '!'}
      />
      <View style={styles.notifContent}>
        <Text style={styles.notifBody} numberOfLines={2}>
          <Text style={styles.notifActor}>
            {item.actor?.name ?? 'MeetSweet'}{' '}
          </Text>
          {item.body.replace(/^.*?sent you|^.*?liked|^.*?followed|^.*?commented/, (m) => m.split(/\s/).slice(1).join(' '))}
        </Text>
        <Text style={styles.notifTime}>{formatTime(item.createdAt)}</Text>
      </View>
      {!item.isRead && <View style={styles.unreadDot} />}
    </TouchableOpacity>
  );
}

function NotifGroup({ title, items, onPress }: { title: string; items: Notification[]; onPress: (n: Notification) => void }) {
  if (items.length === 0) return null;
  return (
    <View>
      <View style={styles.groupHeader}>
        <Text style={styles.groupTitle}>{title}</Text>
      </View>
      {items.map((item) => (
        <NotifRow key={item.id} item={item} onPress={onPress} />
      ))}
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function NotificationsScreen() {
  const insets = useSafeAreaInsets();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [marking, setMarking] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await getNotifications();
      setNotifications(data.notifications);
    } catch {
      // keep existing
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, []);

  const handlePress = async (n: Notification) => {
    if (!n.isRead) {
      setNotifications((prev) =>
        prev.map((x) => (x.id === n.id ? { ...x, isRead: true } : x)),
      );
      markNotificationRead(n.id).catch(() => {});
    }
    // Navigate to post if available
    if (n.postId) {
      router.push(`/content/${n.postId}`);
    }
  };

  const handleMarkAll = async () => {
    if (marking) return;
    setMarking(true);
    try {
      await markAllNotificationsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    } catch {
      // ignore
    } finally {
      setMarking(false);
    }
  };

  const unreadCount = notifications.filter((n) => !n.isRead).length;
  const { today, yesterday, earlier } = groupNotifications(notifications);

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
          <ArrowLeft size={22} color={T.TEXT} strokeWidth={2} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Notifications</Text>
        {unreadCount > 0 ? (
          <TouchableOpacity style={styles.iconBtn} onPress={handleMarkAll} activeOpacity={0.7}>
            {marking ? (
              <Spinner size="sm" color={T.TEXT_2} />
            ) : (
              <Check size={18} color={T.TEXT_2} strokeWidth={2} />
            )}
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.iconBtn} activeOpacity={0.7}>
            <BellOff size={18} color={T.TEXT_2} strokeWidth={1.8} />
          </TouchableOpacity>
        )}
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <Spinner size="lg" color="default" />
        </View>
      ) : notifications.length === 0 ? (
        <MsEmptyState
          title="No notifications yet"
          message="When someone likes your post, follows you, or sends a message, you'll see it here."
        />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
          <NotifGroup title="Today" items={today} onPress={handlePress} />
          <NotifGroup title="Yesterday" items={yesterday} onPress={handlePress} />
          <NotifGroup title="Earlier" items={earlier} onPress={handlePress} />
        </ScrollView>
      )}
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
  },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: T.RADIUS.md,
    backgroundColor: T.SURFACE,
    alignItems: 'center',
    justifyContent: 'center',
  },

  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  groupHeader: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 8,
  },
  groupTitle: {
    fontSize: 11,
    fontFamily: T.FONT.semibold,
    color: T.TEXT_3,
    letterSpacing: 0.9,
    textTransform: 'uppercase',
  },

  notifRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: T.BORDER,
  },
  notifRowUnread: { backgroundColor: 'rgba(255,255,255,0.03)' },
  notifContent: { flex: 1 },
  notifBody: {
    fontSize: 14,
    fontFamily: T.FONT.regular,
    color: T.TEXT,
    lineHeight: 20,
  },
  notifActor: { fontFamily: T.FONT.semibold },
  notifTime: {
    fontSize: 12,
    fontFamily: T.FONT.regular,
    color: T.TEXT_3,
    marginTop: 4,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: T.TEXT,
    marginTop: 4,
  },
});
