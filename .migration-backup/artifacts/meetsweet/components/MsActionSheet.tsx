/**
 * MsActionSheet — reusable native-feeling context menu bottom sheet.
 * Replaces browser-style Alert.alert / ActionSheetIOS for all long-press menus.
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
import { X } from 'phosphor-react-native';
import { T } from '@/constants/theme';

export interface ActionItem {
  label: string;
  destructive?: boolean;
  onPress: () => void;
}

interface MsActionSheetProps {
  visible: boolean;
  title?: string;
  subtitle?: string;
  actions: ActionItem[];
  onClose: () => void;
}

export function MsActionSheet({
  visible,
  title,
  subtitle,
  actions,
  onClose,
}: MsActionSheetProps) {
  const insets = useSafeAreaInsets();

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
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom + 4, 20) }]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.handle} />

          {(title || subtitle) && (
            <View style={styles.header}>
              <View style={{ flex: 1 }}>
                {title && (
                  <Text style={styles.title} numberOfLines={1}>
                    {title}
                  </Text>
                )}
                {subtitle && (
                  <Text style={styles.subtitle} numberOfLines={1}>
                    {subtitle}
                  </Text>
                )}
              </View>
              <TouchableOpacity onPress={onClose} hitSlop={12}>
                <X size={18} color={T.TEXT_2} />
              </TouchableOpacity>
            </View>
          )}

          <View style={styles.actionsWrap}>
            {actions.map((action, idx) => (
              <TouchableOpacity
                key={idx}
                style={[styles.action, idx > 0 && styles.actionBorder]}
                activeOpacity={0.55}
                onPress={() => {
                  onClose();
                  setTimeout(action.onPress, 80);
                }}
              >
                <Text
                  style={[
                    styles.actionLabel,
                    action.destructive && styles.destructiveLabel,
                  ]}
                >
                  {action.label}
                </Text>
              </TouchableOpacity>
            ))}
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
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingTop: 12,
    paddingHorizontal: 20,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignSelf: 'center',
    marginBottom: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: T.BORDER,
  },
  title: {
    fontSize: 16,
    fontFamily: T.FONT.bold,
    color: T.TEXT,
  },
  subtitle: {
    fontSize: 12,
    fontFamily: T.FONT.regular,
    color: T.TEXT_2,
    marginTop: 2,
  },
  actionsWrap: {
    borderRadius: T.RADIUS.md,
    backgroundColor: T.SURFACE_2,
    overflow: 'hidden',
    marginBottom: 4,
  },
  action: {
    paddingVertical: 16,
    paddingHorizontal: 18,
  },
  actionBorder: {
    borderTopWidth: 1,
    borderTopColor: T.BORDER,
  },
  actionLabel: {
    fontSize: 15,
    fontFamily: T.FONT.medium,
    color: T.TEXT,
  },
  destructiveLabel: {
    color: '#EF4444',
  },
});
