package expo.modules.t3nativecontrols

import android.content.ComponentName
import android.content.pm.PackageManager
import com.facebook.react.ReactActivity
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.lang.ref.WeakReference
import java.util.concurrent.CopyOnWriteArraySet

/**
 * Shows or hides the "MadoHomu" launcher icon: the MadoHomuActivity that
 * withAndroidMadoHomuLauncher adds, disabled, to the manifest.
 */
class T3MadoHomuLauncherModule : Module() {
  private val onFocus: (String) -> Unit = { surface ->
    sendEvent("onForegroundSurfaceChange", mapOf("surface" to surface))
  }

  override fun definition() = ModuleDefinition {
    Name("T3MadoHomuLauncher")

    Events("onForegroundSurfaceChange")

    OnCreate { focusListeners.add(onFocus) }
    OnDestroy { focusListeners.remove(onFocus) }

    Function("foregroundSurface") { surfaceOf(focusedReactActivity()) }

    Function("exitFocusedTask") {
      val activity = focusedReactActivity()
      activity?.runOnUiThread {
        if (activity.hasWindowFocus() && !activity.isFinishing) {
          activity.invokeDefaultOnBackPressed()
        }
      }
    }

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

  private fun focusedReactActivity(): ReactActivity? =
    focusedActivity?.get() ?: appContext.currentActivity as? ReactActivity

  companion object {
    @Volatile private var focusedActivity: WeakReference<ReactActivity>? = null
    private val focusListeners = CopyOnWriteArraySet<(String) -> Unit>()

    // Android can keep both activities resumed in split screen.
    fun onActivityFocused(activity: ReactActivity) {
      focusedActivity = WeakReference(activity)
      focusListeners.forEach { it(surfaceOf(activity)) }
    }

    private fun surfaceOf(activity: ReactActivity?): String =
      if (activity?.javaClass?.simpleName == "MadoHomuActivity") "madohomu" else "main"
  }
}
