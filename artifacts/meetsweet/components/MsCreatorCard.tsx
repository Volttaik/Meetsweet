import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { T } from '@/constants/theme';
import { MsAvatar } from '@/components/MsAvatar';

const NAMES = ['Alex Rivera', 'Sarah Moon', 'Dev Studio', 'Creative X', 'Luna Kim', 'Jay Torres', 'Mia Chen'];
const HANDLES = ['@alex.r', '@sarah_m', '@devstudio', '@creativex', '@luna.k', '@jay.t', '@mia.c'];
const BIOS = [
  'Visual storyteller & photographer',
  'Lifestyle content creator',
  'Tech educator & developer',
  'Art director & designer',
  'Fitness & wellness coach',
  'Music producer & DJ',
  'Travel & adventure creator',
];

interface MsCreatorCardProps {
  id: number;
  variant?: 'compact' | 'featured';
  onPress?: () => void;
}

export function MsCreatorCard({ id, variant = 'compact', onPress }: MsCreatorCardProps) {
  const idx = (id - 1) % NAMES.length;
  const name = NAMES[idx];
  const handle = HANDLES[idx];
  const bio = BIOS[idx];
  const initials = name.split(' ').map((n) => n[0]).join('').slice(0, 2);
  const online = id % 3 === 0;

  if (variant === 'compact') {
    return (
      <TouchableOpacity style={styles.compact} activeOpacity={0.75} onPress={onPress}>
        <MsAvatar size={58} initials={initials} showOnline={online} />
        <Text style={styles.compactName} numberOfLines={1}>
          {name.split(' ')[0]}
        </Text>
        <Text style={styles.compactHandle} numberOfLines={1}>{handle}</Text>
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity style={styles.featured} activeOpacity={0.75} onPress={onPress}>
      <MsAvatar size={50} initials={initials} showOnline={online} />
      <Text style={styles.featuredName} numberOfLines={1}>{name}</Text>
      <Text style={styles.featuredHandle} numberOfLines={1}>{handle}</Text>
      <Text style={styles.featuredBio} numberOfLines={2}>{bio}</Text>
      <View style={styles.followBtn}>
        <Text style={styles.followLabel}>Follow</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  compact: {
    width: 76,
    alignItems: 'center',
    gap: 5,
  },
  compactName: {
    fontSize: 12,
    fontFamily: T.FONT.semibold,
    color: T.TEXT,
    textAlign: 'center',
  },
  compactHandle: {
    fontSize: 10,
    fontFamily: T.FONT.regular,
    color: T.TEXT_2,
    textAlign: 'center',
  },

  featured: {
    width: 152,
    backgroundColor: T.SURFACE,
    borderRadius: T.RADIUS.lg,
    borderWidth: 1,
    borderColor: T.BORDER_2,
    padding: 16,
    gap: 5,
  },
  featuredName: {
    fontSize: 14,
    fontFamily: T.FONT.semibold,
    color: T.TEXT,
    marginTop: 6,
  },
  featuredHandle: {
    fontSize: 12,
    fontFamily: T.FONT.regular,
    color: T.TEXT_2,
    marginTop: -2,
  },
  featuredBio: {
    fontSize: 12,
    fontFamily: T.FONT.regular,
    color: T.TEXT_3,
    lineHeight: 17,
    marginTop: 2,
  },
  followBtn: {
    marginTop: 10,
    height: 32,
    borderRadius: T.RADIUS.sm,
    backgroundColor: T.TEXT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  followLabel: {
    fontSize: 12,
    fontFamily: T.FONT.semibold,
    color: T.BG,
  },
});
