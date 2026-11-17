package expo.modules.t3nativecontrols

import android.content.ComponentName
import android.content.pm.PackageManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Shows or hides the "MadoHomu" launcher icon: the MadoHomuActivity that
 * withAndroidMadoHomuLauncher adds, disabled, to the manifest.
 */
class T3MadoHomuLauncherModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("T3MadoHomuLauncher")

    Function("setEnabled") { enabled: Boolean ->
      val context = appContext.reactContext ?: return@Function false
      val packageManager = context.packageManager
      // The activity lives in the app's namespace, which need not match the variant's package.
      val activity = packageManager
        .getPackageInfo(
          context.packageName,
          PackageManager.GET_ACTIVITIES or PackageManager.MATCH_DISABLED_COMPONENTS,
        )
        .activities
        ?.firstOrNull { it.name.endsWith(".MadoHomuActivity") }
        ?: return@Function false
      val component = ComponentName(context.packageName, activity.name)
      val state = if (enabled) {
        PackageManager.COMPONENT_ENABLED_STATE_ENABLED
      } else {
        PackageManager.COMPONENT_ENABLED_STATE_DEFAULT
      }
      if (packageManager.getComponentEnabledSetting(component) != state) {
        // DONT_KILL_APP: without it Android kills the app process on every switch.
        packageManager.setComponentEnabledSetting(component, state, PackageManager.DONT_KILL_APP)
      }
      true
    }
  }
}
