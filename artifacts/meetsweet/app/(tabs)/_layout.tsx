import React, { useCallback } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, Image } from 'react-native';
import { Tabs, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { House, MagnifyingGlass, ChatCircle, User, type Icon } from 'phosphor-react-native';
import { T } from '@/constants/theme';

const TAB_HEIGHT = 60;
const INACTIVE_COLOR = '#777777';

type VisualTab = {
  label: string;
  Icon: Icon;
  routeName?: string; // undefined = center action
  badge?: number;
};

const VISUAL_TABS: VisualTab[] = [
  { label: 'Home',     Icon: House,           routeName: 'index' },
  { label: 'Explore',  Icon: MagnifyingGlass, routeName: 'explore' },
  { label: 'Create',   Icon: ChatCircle },
  { label: 'Messages', Icon: ChatCircle,      routeName: 'messages' },
  { label: 'Profile',  Icon: User,            routeName: 'profile' },
];

function TabBadgeDot({ count }: { count?: number }) {
  if (!count || count <= 0) return null;
  return (
    <View style={badgeStyles.wrap}>
      {count <= 9 ? (
        <Text style={badgeStyles.text}>{count}</Text>
      ) : (
        <Text style={badgeStyles.text}>9+</Text>
      )}
    </View>
  );
}

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
  if (tab.routeName === undefined) {
    return (
      <Pressable onPress={handlePress} style={styles.centerWrap}>
        <Animated.View style={[styles.centerBtn, scaleStyle]}>
          <Image
            source={require('../../assets/images/logo.png')}
            style={styles.centerLogo}
            resizeMode="contain"
            accessibilityLabel="MeetSweet"
          />
        </Animated.View>
      </Pressable>
    );
  }

  const iconColor = isActive ? T.TEXT : INACTIVE_COLOR;

  return (
    <Pressable onPress={handlePress} style={styles.tabWrap}>
      <Animated.View style={[styles.tabInner, scaleStyle]}>
        <View style={styles.iconWrap}>
          <tab.Icon size={22} color={iconColor} weight="regular" />
          <TabBadgeDot count={tab.badge} />
        </View>
        <Text
          style={[
            styles.tabLabel,
            { color: iconColor, fontFamily: isActive ? T.FONT.semibold : T.FONT.regular },
          ]}
        >
          {tab.label}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

function CustomTabBar({ state, navigation }: { state: any; navigation: any }) {
  const insets = useSafeAreaInsets();

  const handlePress = useCallback(
    (tab: VisualTab) => {
      if (tab.routeName === undefined) {
        router.push('/create-post');
        return;
      }
      const route = state.routes.find(
        (candidate: { name: string }) => candidate.name === tab.routeName,
      );
      if (route && state.routes[state.index]?.name !== tab.routeName) {
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
          isActive={
            tab.routeName !== undefined &&
            state.routes[state.index]?.name === tab.routeName
          }
          onPress={() => handlePress(tab)}
        />
      ))}
    </View>
  );
}

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

const badgeStyles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: -4,
    right: -6,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
    borderWidth: 1.5,
    borderColor: T.BG,
  },
  text: {
    fontSize: 9,
    fontFamily: T.FONT.bold,
    color: '#FFFFFF',
    lineHeight: 12,
  },
});

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: T.BG,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: T.BORDER,
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
  iconWrap: {
    position: 'relative',
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
  centerLogo: {
    width: 34,
    height: 34,
    borderRadius: 17,
  },
});
