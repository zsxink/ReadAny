/**
 * TabNavigator — bottom tab bar matching the Tauri mobile app's 4 tabs.
 */
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { LibraryScreen } from "@/screens/LibraryScreen";
import { ChatScreen } from "@/screens/ChatScreen";
import { NotesScreen } from "@/screens/NotesScreen";
import { ProfileScreen } from "@/screens/ProfileScreen";
import { useTranslation } from "react-i18next";

export type TabParamList = {
  Library: undefined;
  Chat: undefined;
  Notes: undefined;
  Profile: undefined;
};

const Tab = createBottomTabNavigator<TabParamList>();

export function TabNavigator() {
  const { t } = useTranslation();

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: "#6366f1",
        tabBarInactiveTintColor: "#71717a",
        tabBarStyle: {
          backgroundColor: "#0a0a0a",
          borderTopColor: "#27272a",
        },
      }}
    >
      <Tab.Screen
        name="Library"
        component={LibraryScreen}
        options={{ tabBarLabel: t("tabs.library", "书架") }}
      />
      <Tab.Screen
        name="Chat"
        component={ChatScreen}
        options={{ tabBarLabel: t("tabs.ai", "AI") }}
      />
      <Tab.Screen
        name="Notes"
        component={NotesScreen}
        options={{ tabBarLabel: t("tabs.notes", "笔记") }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{ tabBarLabel: t("tabs.profile", "我的") }}
      />
    </Tab.Navigator>
  );
}
