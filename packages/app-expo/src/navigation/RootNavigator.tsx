import { BookChatScreen } from "@/screens/BookChatScreen";
import { ReaderScreen } from "@/screens/ReaderScreen";
import SkillsScreen from "@/screens/SkillsScreen";
import StatsScreen from "@/screens/StatsScreen";
import AISettingsScreen from "@/screens/settings/AISettingsScreen";
import AboutScreen from "@/screens/settings/AboutScreen";
import AppearanceSettingsScreen from "@/screens/settings/AppearanceSettingsScreen";
import SyncSettingsScreen from "@/screens/settings/SyncSettingsScreen";
import TTSSettingsScreen from "@/screens/settings/TTSSettingsScreen";
import TranslationSettingsScreen from "@/screens/settings/TranslationSettingsScreen";
import VectorModelSettingsScreen from "@/screens/settings/VectorModelSettingsScreen";
/**
 * RootNavigator — top-level stack matching Tauri mobile App.tsx routes exactly.
 */
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { TabNavigator } from "./TabNavigator";

export type RootStackParamList = {
  Tabs: undefined;
  Reader: { bookId: string; cfi?: string };
  BookChat: { bookId: string };
  Stats: undefined;
  Skills: undefined;
  VectorModelSettings: undefined;
  AppearanceSettings: undefined;
  AISettings: undefined;
  TTSSettings: undefined;
  TranslationSettings: undefined;
  SyncSettings: undefined;
  About: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Tabs" component={TabNavigator} />
      <Stack.Screen
        name="Reader"
        component={ReaderScreen}
        options={{ animation: "slide_from_right" }}
      />
      <Stack.Screen
        name="BookChat"
        component={BookChatScreen}
        options={{ animation: "slide_from_right" }}
      />
      <Stack.Screen
        name="Stats"
        component={StatsScreen}
        options={{ animation: "slide_from_right" }}
      />
      <Stack.Screen
        name="Skills"
        component={SkillsScreen}
        options={{ animation: "slide_from_right" }}
      />
      <Stack.Screen
        name="VectorModelSettings"
        component={VectorModelSettingsScreen}
        options={{ animation: "slide_from_right" }}
      />
      <Stack.Screen name="AppearanceSettings" component={AppearanceSettingsScreen} />
      <Stack.Screen name="AISettings" component={AISettingsScreen} />
      <Stack.Screen name="TTSSettings" component={TTSSettingsScreen} />
      <Stack.Screen name="TranslationSettings" component={TranslationSettingsScreen} />
      <Stack.Screen name="SyncSettings" component={SyncSettingsScreen} />
      <Stack.Screen name="About" component={AboutScreen} />
    </Stack.Navigator>
  );
}
