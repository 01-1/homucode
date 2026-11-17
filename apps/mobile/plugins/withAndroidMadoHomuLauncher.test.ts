import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { AndroidConfig, compileModsAsync, XML } from "expo/config-plugins";
import { afterEach, describe, expect, it } from "vite-plus/test";

import withAndroidMadoHomuLauncher from "./withAndroidMadoHomuLauncher.cjs";
import withAndroidTabletOrientation from "./withAndroidTabletOrientation.cjs";

const MANIFEST = `<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  <application android:name=".MainApplication">
    <activity android:name=".MainActivity" android:configChanges="keyboard|orientation|screenSize|smallestScreenSize" android:theme="@style/Theme.App.SplashScreen" android:windowSoftInputMode="adjustResize" android:launchMode="singleTask" android:exported="true">
      <intent-filter>
        <action android:name="android.intent.action.MAIN"/>
        <category android:name="android.intent.category.LAUNCHER"/>
      </intent-filter>
    </activity>
  </application>
</manifest>`;

// Trimmed from the MainActivity.kt that `expo prebuild` generates for this app.
const MAIN_ACTIVITY = `package com.t3tools.t3code

import android.os.Build
import android.os.Bundle

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

import expo.modules.ReactActivityDelegateWrapper

class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    setTheme(R.style.AppTheme);
    super.onCreate(null)
  }

  override fun getMainComponentName(): String = "main"

  override fun createReactActivityDelegate(): ReactActivityDelegate {
    return ReactActivityDelegateWrapper(
          this,
          BuildConfig.IS_NEW_ARCHITECTURE_ENABLED,
          object : DefaultReactActivityDelegate(
              this,
              mainComponentName,
              fabricEnabled
          ){})
  }
}
`;

const projectRoots: string[] = [];

afterEach(() => {
  for (const root of projectRoots.splice(0)) NodeFS.rmSync(root, { recursive: true, force: true });
});

async function prebuildAndroid() {
  const projectRoot = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "madohomu-launcher-"));
  projectRoots.push(projectRoot);
  const sourceRoot = NodePath.join(projectRoot, "android/app/src/main");
  const activityDir = NodePath.join(sourceRoot, "java/com/t3tools/t3code");
  NodeFS.mkdirSync(activityDir, { recursive: true });
  NodeFS.mkdirSync(NodePath.join(sourceRoot, "res/values"), { recursive: true });
  NodeFS.writeFileSync(NodePath.join(sourceRoot, "res/values/colors.xml"), "<resources/>");
  NodeFS.writeFileSync(NodePath.join(sourceRoot, "AndroidManifest.xml"), MANIFEST);
  NodeFS.writeFileSync(NodePath.join(activityDir, "MainActivity.kt"), MAIN_ACTIVITY);

  // Registered first like in app.config.ts, so it copies the other plugins' MainActivity.
  const config = withAndroidTabletOrientation(
    withAndroidMadoHomuLauncher({
      name: "T3 Code",
      slug: "t3code",
      android: { package: "com.t3tools.t3code" },
    }),
  );
  await compileModsAsync(config, { projectRoot, platforms: ["android"] });
  const read = (path: string) => NodeFS.readFileSync(NodePath.join(sourceRoot, path), "utf8");
  return {
    manifest: read("AndroidManifest.xml"),
    madohomuActivity: read("java/com/t3tools/t3code/MadoHomuActivity.kt"),
    adaptiveIcon: read("res/mipmap-anydpi-v26/ic_madohomu.xml"),
    legacyIcon: read("res/values/madohomu_launcher.xml"),
    colors: read("res/values/colors.xml"),
  };
}

describe("withAndroidMadoHomuLauncher", () => {
  it("adds a disabled MadoHomu launcher activity in its own task", async () => {
    const { manifest } = await prebuildAndroid();
    const parsed = (await XML.parseXMLAsync(manifest)) as AndroidConfig.Manifest.AndroidManifest;
    const activities = AndroidConfig.Manifest.getMainApplicationOrThrow(parsed).activity ?? [];
    const madohomu = activities.find((entry) => entry.$["android:name"] === ".MadoHomuActivity");

    expect(madohomu?.$).toMatchObject({
      "android:label": "MadoHomu",
      "android:icon": "@mipmap/ic_madohomu",
      "android:taskAffinity": "com.t3tools.t3code.madohomu",
      "android:launchMode": "singleTask",
      "android:enabled": "false",
      "android:exported": "true",
      "android:theme": "@style/Theme.App.SplashScreen",
      "android:windowSoftInputMode": "adjustResize",
    });
    expect(madohomu?.["intent-filter"]?.[0]?.category?.[0]?.$["android:name"]).toBe(
      "android.intent.category.LAUNCHER",
    );
    // The main activity keeps its own launcher entry and task.
    expect(AndroidConfig.Manifest.getMainActivityOrThrow(parsed).$["android:enabled"]).toBe(
      undefined,
    );
  });

  it("copies the finished MainActivity and opens MadoHomu in its React root", async () => {
    const { madohomuActivity } = await prebuildAndroid();

    expect(madohomuActivity).toContain("class MadoHomuActivity : ReactActivity()");
    expect(madohomuActivity).not.toContain("class MainActivity");
    expect(madohomuActivity).toMatch(
      /object : DefaultReactActivityDelegate\([^)]*\)\{\s*override fun getLaunchOptions\(\): Bundle = Bundle\(\)\.apply \{ putString\("launchSurface", "madohomu"\) \}/,
    );
    // Other MainActivity plugins ran first, so the fold/orientation handling is copied too.
    expect(madohomuActivity).toContain("applyTabletOrientation()");
  });

  it("derives the icon from the app's adaptive icon layers", async () => {
    const { adaptiveIcon, legacyIcon, colors } = await prebuildAndroid();

    expect(adaptiveIcon).toContain(
      '<background android:drawable="@color/madohomu_icon_background"/>',
    );
    expect(adaptiveIcon).toContain("@mipmap/ic_launcher_foreground");
    expect(adaptiveIcon).toContain("@mipmap/ic_launcher_monochrome");
    expect(legacyIcon).toContain(
      '<item name="ic_madohomu" type="mipmap">@mipmap/ic_launcher</item>',
    );
    expect(colors).toContain('name="madohomu_icon_background"');
  });
});
