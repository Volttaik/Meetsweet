import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { T } from '@/constants/theme';
import { MsAvatar } from '@/components/MsAvatar';

interface MsNotificationCardProps {
  initials: string;
  username: string;
  message: string;
  time: string;
  isUnread?: boolean;
  onPress?: () => void;
}

export function MsNotificationCard({
  initials,
  username,
  message,
  time,
  isUnread = false,
  onPress,
}: MsNotificationCardProps) {
  return (
    <TouchableOpacity
      style={[styles.row, isUnread && styles.rowUnread]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <MsAvatar size={44} initials={initials} />
      <View style={styles.content}>
        <Text style={styles.text} numberOfLines={2}>
          <Text style={styles.username}>{username}</Text>
          <Text style={styles.msg}> {message}</Text>
        </Text>
        <Text style={styles.time}>{time}</Text>
      </View>
      {isUnread && <View style={styles.dot} />}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: T.BORDER,
  },
  rowUnread: {
    backgroundColor: 'rgba(255,255,255,0.025)',
  },
  content: { flex: 1, gap: 4 },
  text: { lineHeight: 20 },
  username: {
    fontSize: 14,
    fontFamily: T.FONT.semibold,
    color: T.TEXT,
  },
  msg: {
    fontSize: 14,
    fontFamily: T.FONT.regular,
    color: T.TEXT_2,
  },
  time: {
    fontSize: 12,
    fontFamily: T.FONT.regular,
    color: T.TEXT_3,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: T.TEXT,
    marginTop: 7,
    flexShrink: 0,
  },
});
