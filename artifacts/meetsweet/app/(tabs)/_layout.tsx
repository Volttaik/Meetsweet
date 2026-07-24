import React, { useCallback } from 'react';
import { Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Tabs, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { House, MagnifyingGlass, ChatCircle, User } from 'phosphor-react-native';
import { T } from '@/constants/theme';

const TAB_HEIGHT = 60;
const INACTIVE_COLOR = '#777777';

type VisualTab = {
  label: string;
  Icon: React.ComponentType<{ size: number; color: string; weight?: string }>;
  routeName?: string; // undefined = center action
};

const VISUAL_TABS: VisualTab[] = [
  { label: 'Home',     Icon: House,            routeName: 'index' },
  { label: 'Explore',  Icon: MagnifyingGlass,  routeName: 'explore' },
  { label: 'Create',   Icon: ChatCircle },
  { label: 'Messages', Icon: ChatCircle,       routeName: 'messages' },
  { label: 'Profile',  Icon: User,             routeName: 'profile' },
];

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
  const strokeWidth = 2.2;

  return (
    <Pressable onPress={handlePress} style={styles.tabWrap}>
      <Animated.View style={[styles.tabInner, scaleStyle]}>
        <tab.Icon size={22} color={iconColor} weight="regular" />
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
      const route = state.routes.find((candidate: { name: string }) => candidate.name === tab.routeName);
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
          isActive={tab.routeName !== undefined && state.routes[state.index]?.name === tab.routeName}
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

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: T.BG,
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
  centerLogo: {
    width: 34,
    height: 34,
    borderRadius: 17,
  },
});
