import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { T } from '@/constants/theme';

interface MsAvatarProps {
  size?: number;
  initials?: string;
  imageUri?: string;
  showOnline?: boolean;
  badgeCount?: number;
}

export function MsAvatar({
  size = 40,
  initials = 'U',
  imageUri,
  showOnline = false,
  badgeCount,
}: MsAvatarProps) {
  const radius = size / 2;
  const dotSize = Math.max(Math.floor(size * 0.26), 10);
  const fontSize = Math.floor(size * 0.36);

  return (
    <View style={{ width: size, height: size }}>
      <View
        style={[
          styles.circle,
          { width: size, height: size, borderRadius: radius },
        ]}
      >
        {imageUri ? (
          <Image
            source={{ uri: imageUri }}
            style={{ width: size, height: size, borderRadius: radius }}
            resizeMode="cover"
          />
        ) : (
          <Text style={[styles.initials, { fontSize }]}>
            {initials.toUpperCase().slice(0, 2)}
          </Text>
        )}
      </View>

      {showOnline && (
        <View
          style={[
            styles.onlineDot,
            {
              width: dotSize,
              height: dotSize,
              borderRadius: dotSize / 2,
            },
          ]}
        />
      )}

      {badgeCount !== undefined && badgeCount > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>
            {badgeCount > 99 ? '99+' : String(badgeCount)}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  circle: {
    backgroundColor: T.SURFACE_2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: T.BORDER_2,
    overflow: 'hidden',
  },
  initials: {
    fontFamily: T.FONT.semibold,
    color: T.TEXT,
  },
  onlineDot: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: T.SUCCESS,
    borderWidth: 2,
    borderColor: T.BG,
  },
  badge: {
    position: 'absolute',
    top: -2,
    right: -4,
    minWidth: 16,
    height: 16,
    borderRadius: T.RADIUS.full,
    backgroundColor: T.TEXT,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
    borderWidth: 1.5,
    borderColor: T.BG,
  },
  badgeText: {
    fontSize: 9,
    fontFamily: T.FONT.bold,
    color: T.BG,
  },
});
