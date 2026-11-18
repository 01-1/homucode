import { StackActions, useIsFocused, useNavigation } from "@react-navigation/native";
import { Keyboard, Platform } from "react-native";
import { returnToAndroidWorkspaceList } from "../../../lib/android-workspace-navigation";
import { useTaskHardwareBack } from "../../../lib/backHandler";

export function useWorkspaceBackNavigation() {
  const navigation = useNavigation();
  return () => {
    if (Platform.OS === "android") returnToAndroidWorkspaceList(navigation);
    else if (navigation.canGoBack()) navigation.goBack();
    else navigation.dispatch(StackActions.replace("Home"));
  };
}

export function useAndroidWorkspaceBack() {
  const focused = useIsFocused();
  const goBack = useWorkspaceBackNavigation();
  useTaskHardwareBack(Platform.OS === "android" && focused, () => {
    if (Keyboard.isVisible()) Keyboard.dismiss();
    else goBack();
    return true;
  });
  return goBack;
}
