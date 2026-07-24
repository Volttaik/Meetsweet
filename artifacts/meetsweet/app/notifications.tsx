import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, BellOff } from 'lucide-react-native';
import { router } from 'expo-router';
import { T } from '@/constants/theme';
import { MsNotificationCard } from '@/components/MsNotificationCard';

type Notif = {
  id: number;
  initials: string;
  username: string;
  message: string;
  time: string;
  isUnread: boolean;
};

const TODAY: Notif[] = [
  { id: 1, initials: 'AR', username: 'alex.rivera',  message: 'started following you',                    time: '2 min ago',   isUnread: true  },
  { id: 2, initials: 'SM', username: 'sarah_moon',   message: 'liked your post',                          time: '15 min ago',  isUnread: true  },
  { id: 3, initials: 'DS', username: 'devstudio',    message: 'commented: "Amazing work! 🔥"',           time: '45 min ago',  isUnread: false },
];

const YESTERDAY: Notif[] = [
  { id: 4, initials: 'CX', username: 'creativex',    message: 'subscribed to your profile',              time: 'Yesterday, 6:30 PM',  isUnread: false },
  { id: 5, initials: 'LK', username: 'luna.k',       message: 'mentioned you in a comment',              time: 'Yesterday, 2:15 PM',  isUnread: false },
];

const EARLIER: Notif[] = [
  { id: 6, initials: 'JT', username: 'jay.torres',   message: 'started following you',                   time: '3 days ago',  isUnread: false },
  { id: 7, initials: 'MC', username: 'mia.chen',     message: 'liked 5 of your posts',                  time: '4 days ago',  isUnread: false },
  { id: 8, initials: 'AX', username: 'alexa.rose',   message: 'shared your post with their followers',  time: '5 days ago',  isUnread: false },
];

function NotifGroup({ title, items }: { title: string; items: Notif[] }) {
  return (
    <View>
      <View style={styles.groupHeader}>
        <Text style={styles.groupTitle}>{title}</Text>
      </View>
      {items.map((item) => (
        <MsNotificationCard
          key={item.id}
          initials={item.initials}
          username={item.username}
          message={item.message}
          time={item.time}
          isUnread={item.isUnread}
        />
      ))}
    </View>
  );
}

export default function NotificationsScreen() {
  const insets = useSafeAreaInsets();

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
        <TouchableOpacity style={styles.iconBtn} activeOpacity={0.7}>
          <BellOff size={18} color={T.TEXT_2} strokeWidth={1.8} />
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        <NotifGroup title="Today" items={TODAY} />
        <NotifGroup title="Yesterday" items={YESTERDAY} />
        <NotifGroup title="Earlier" items={EARLIER} />
      </ScrollView>
    </View>
  );
}

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
});
