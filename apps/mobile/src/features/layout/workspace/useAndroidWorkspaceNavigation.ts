import { StackActions, useFocusEffect, useNavigation } from "@react-navigation/native";
import { useCallback } from "react";
import { BackHandler, Keyboard, Platform } from "react-native";
import { returnToAndroidWorkspaceList } from "../../../lib/android-workspace-navigation";
import { isInForegroundRoot } from "../../../lib/rootNavigation";

export function useWorkspaceBackNavigation() {
  const navigation = useNavigation();
  return () => {
    if (Platform.OS === "android") returnToAndroidWorkspaceList(navigation);
    else if (navigation.canGoBack()) navigation.goBack();
    else navigation.dispatch(StackActions.replace("Home"));
  };
}

export function useAndroidWorkspaceBack() {
  const navigation = useNavigation();
  const goBack = useWorkspaceBackNavigation();
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== "android") return;
      const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
        if (!isInForegroundRoot(navigation)) return false;
        if (Keyboard.isVisible()) Keyboard.dismiss();
        else goBack();
        return true;
      });
      return () => subscription.remove();
    }, [goBack, navigation]),
  );
  return goBack;
}
