import React, { useCallback } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Tabs, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Home, Search, Plus, MessageCircle, User } from 'lucide-react-native';
import { T } from '@/constants/theme';

const TAB_HEIGHT = 60;

type VisualTab = {
  label: string;
  Icon: React.ComponentType<{ size: number; color: string; strokeWidth: number }>;
  routeIndex?: number; // undefined = center action, no route
};

const VISUAL_TABS: VisualTab[] = [
  { label: 'Home',     Icon: Home,          routeIndex: 0 },
  { label: 'Explore',  Icon: Search,         routeIndex: 1 },
  { label: 'Create',   Icon: Plus            },          // center — no routeIndex
  { label: 'Messages', Icon: MessageCircle,  routeIndex: 2 },
  { label: 'Profile',  Icon: User,           routeIndex: 3 },
];

// ─── Single tab button ────────────────────────────────────────────────────────

function TabBtn({
  tab,
  isActive,
  onPress,
}: {
  tab: VisualTab;
  isActive: boolean;
  onPress: () => void;
}) {
  const scale = useSharedValue(1);
  const scaleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePress = () => {
    scale.value = withTiming(0.84, { duration: 75, easing: Easing.out(Easing.cubic) }, () => {
      scale.value = withTiming(1, { duration: 150, easing: Easing.out(Easing.back(1.6)) });
    });
    onPress();
  };

  // Center Create button
  if (tab.routeIndex === undefined) {
    return (
      <Pressable onPress={handlePress} style={styles.centerWrap}>
        <Animated.View style={[styles.centerBtn, scaleStyle]}>
          <tab.Icon size={20} color="#000000" strokeWidth={2.5} />
        </Animated.View>
      </Pressable>
    );
  }

  const color = isActive ? T.TEXT : T.TEXT_2;
  return (
    <Pressable onPress={handlePress} style={styles.tabWrap}>
      <Animated.View style={[styles.tabInner, scaleStyle]}>
        <tab.Icon size={22} color={color} strokeWidth={isActive ? 2.2 : 1.6} />
        <Text
          style={[
            styles.tabLabel,
            { color, fontFamily: isActive ? T.FONT.semibold : T.FONT.regular },
          ]}
        >
          {tab.label}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

// ─── Custom tab bar ───────────────────────────────────────────────────────────

function CustomTabBar({ state, navigation }: { state: any; navigation: any }) {
  const insets = useSafeAreaInsets();

  const handlePress = useCallback(
    (tab: VisualTab) => {
      if (tab.routeIndex === undefined) {
        // TODO: check creator status → route to creator-dashboard if already a creator
        router.push('/become-creator');
        return;
      }
      const route = state.routes[tab.routeIndex];
      if (route && state.index !== tab.routeIndex) {
        navigation.navigate(route.name);
      }
    },
    [state, navigation],
  );

  return (
    <View
      style={[
        styles.bar,
        { paddingBottom: Math.max(insets.bottom, Platform.OS === 'android' ? 10 : 0) },
      ]}
    >
      {VISUAL_TABS.map((tab, i) => (
        <TabBtn
          key={i}
          tab={tab}
          isActive={tab.routeIndex !== undefined && state.index === tab.routeIndex}
          onPress={() => handlePress(tab)}
        />
      ))}
    </View>
  );
}

// ─── Layout ───────────────────────────────────────────────────────────────────

export default function TabLayout() {
  return (
    <Tabs
      tabBar={(props) => (
        <CustomTabBar state={props.state} navigation={props.navigation} />
      )}
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="explore" />
      <Tabs.Screen name="messages" />
      <Tabs.Screen name="profile" />
    </Tabs>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: T.BG,
    borderTopWidth: 1,
    borderTopColor: T.BORDER_2,
    paddingTop: 8,
  },
  tabWrap: {
    flex: 1,
    height: TAB_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabInner: {
    alignItems: 'center',
    gap: 3,
  },
  tabLabel: {
    fontSize: 10,
    letterSpacing: 0.1,
  },
  centerWrap: {
    flex: 1,
    height: TAB_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: T.TEXT,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
});
