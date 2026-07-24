/**
 * MsCreatorPreview — lightweight preview sheet that appears when tapping
 * a creator avatar anywhere in the app. Avoids full navigation.
 */
import React from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, Users, X } from 'phosphor-react-native';
import { MsAvatar } from '@/components/MsAvatar';
import { T } from '@/constants/theme';

export interface CreatorPreviewData {
  id: string;
  name: string;
  handle: string;
  bio?: string;
  initials: string;
  avatarUrl?: string;
  isVerified?: boolean;
  isOnline?: boolean;
  followers?: string;
  monthlyCredits?: number;
  category?: string;
}

interface MsCreatorPreviewProps {
  visible: boolean;
  creator: CreatorPreviewData | null;
  onClose: () => void;
  onViewProfile: () => void;
  onSubscribe: () => void;
}

export function MsCreatorPreview({
  visible,
  creator,
  onClose,
  onViewProfile,
  onSubscribe,
}: MsCreatorPreviewProps) {
  const insets = useSafeAreaInsets();

  if (!creator) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom + 8, 24) }]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.pill} />

          <View style={styles.closeRow}>
            <TouchableOpacity onPress={onClose} hitSlop={12} style={styles.closeBtn}>
              <X size={15} color={T.TEXT_2} />
            </TouchableOpacity>
          </View>

          <View style={styles.body}>
            <MsAvatar
              size={76}
              initials={creator.initials}
              imageUri={creator.avatarUrl}
              showOnline={creator.isOnline}
            />

            <View style={styles.nameRow}>
              <Text style={styles.name} numberOfLines={1}>
                {creator.name}
              </Text>
              {creator.isVerified && <Check size={15} color={T.TEXT} />}
            </View>

            <Text style={styles.userHandle}>{creator.handle}</Text>

            {creator.category ? (
              <Text style={styles.category}>{creator.category.toUpperCase()}</Text>
            ) : null}

            {creator.bio ? (
              <Text style={styles.bio} numberOfLines={3}>
                {creator.bio}
              </Text>
            ) : null}

            {(creator.followers || creator.monthlyCredits !== undefined) ? (
              <View style={styles.metrics}>
                {creator.followers ? (
                  <View style={styles.metric}>
                    <Users size={12} color={T.TEXT_2} />
                    <Text style={styles.metricText}>{creator.followers}</Text>
                  </View>
                ) : null}
                {creator.monthlyCredits !== undefined ? (
                  <View style={[styles.metric, styles.metricRight]}>
                    <Text style={styles.metricText}>{creator.monthlyCredits} credits / mo</Text>
                  </View>
                ) : null}
              </View>
            ) : null}

            <View style={styles.buttons}>
              <TouchableOpacity
                style={styles.subscribeBtn}
                activeOpacity={0.8}
                onPress={() => { onClose(); onSubscribe(); }}
              >
                <Text style={styles.subscribeBtnLabel}>Subscribe</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.viewBtn}
                activeOpacity={0.75}
                onPress={() => { onClose(); onViewProfile(); }}
              >
                <Text style={styles.viewBtnLabel}>View Profile</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: T.SURFACE,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 12,
    paddingHorizontal: 24,
  },
  pill: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignSelf: 'center',
    marginBottom: 8,
  },
  closeRow: {
    alignItems: 'flex-end',
    marginBottom: 4,
  },
  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: T.SURFACE_2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    alignItems: 'center',
    gap: 5,
    paddingBottom: 4,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 14,
  },
  name: {
    fontSize: 22,
    fontFamily: T.FONT.bold,
    color: T.TEXT,
    letterSpacing: -0.5,
  },
  userHandle: {
    fontSize: 13,
    fontFamily: T.FONT.regular,
    color: T.TEXT_2,
  },
  category: {
    fontSize: 9,
    fontFamily: T.FONT.semibold,
    color: T.TEXT_3,
    letterSpacing: 1.2,
    marginTop: 2,
  },
  bio: {
    fontSize: 13,
    fontFamily: T.FONT.regular,
    color: T.TEXT_2,
    textAlign: 'center',
    lineHeight: 20,
    marginTop: 10,
    maxWidth: 300,
  },
  metrics: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: T.BORDER,
    width: '100%',
  },
  metric: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  metricRight: {
    borderLeftWidth: 1,
    borderLeftColor: T.BORDER_2,
    paddingLeft: 20,
  },
  metricText: {
    fontSize: 12,
    fontFamily: T.FONT.medium,
    color: T.TEXT_2,
  },
  buttons: {
    width: '100%',
    gap: 10,
    marginTop: 22,
  },
  subscribeBtn: {
    height: 50,
    borderRadius: T.RADIUS.full,
    backgroundColor: T.TEXT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  subscribeBtnLabel: {
    fontSize: 15,
    fontFamily: T.FONT.semibold,
    color: T.BG,
  },
  viewBtn: {
    height: 44,
    borderRadius: T.RADIUS.full,
    backgroundColor: T.SURFACE_2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewBtnLabel: {
    fontSize: 14,
    fontFamily: T.FONT.medium,
    color: T.TEXT,
  },
});
