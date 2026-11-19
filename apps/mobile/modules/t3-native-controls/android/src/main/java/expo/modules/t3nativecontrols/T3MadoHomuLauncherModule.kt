package expo.modules.t3nativecontrols

import android.content.ComponentName
import android.content.pm.PackageManager
import com.facebook.react.ReactActivity
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.lang.ref.WeakReference
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArraySet
import java.util.concurrent.atomic.AtomicInteger

/**
 * Shows or hides the "MadoHomu" launcher icon: the MadoHomuActivity that
 * withAndroidMadoHomuLauncher adds, disabled, to the manifest.
 */
class T3MadoHomuLauncherModule : Module() {
  private val backRequestId = AtomicInteger()
  private val backActivities = ConcurrentHashMap<Int, WeakReference<ReactActivity>>()

  private val onFocus: (String) -> Unit = { surface ->
    sendEvent("onForegroundSurfaceChange", mapOf("surface" to surface))
  }

  private val onBack: (ReactActivity) -> Unit = { activity ->
    val id = backRequestId.incrementAndGet()
    backActivities[id] = WeakReference(activity)
    sendEvent("onTaskBackPress", mapOf("id" to id, "surface" to surfaceOf(activity)))
  }

  override fun definition() = ModuleDefinition {
    Name("T3MadoHomuLauncher")

    Events("onForegroundSurfaceChange", "onTaskBackPress")

    OnCreate { focusListeners.add(onFocus) }
    OnDestroy {
      focusListeners.remove(onFocus)
      stopBackReporting()
    }
    OnStartObserving("onTaskBackPress") { backListeners.add(onBack) }
    OnStopObserving("onTaskBackPress") { stopBackReporting() }

    Function("foregroundSurface") { surfaceOf(focusedReactActivity()) }

    Function("completeTaskBack") { id: Int, handled: Boolean ->
      val activity = backActivities.remove(id)?.get()
      if (!handled && activity != null) {
        activity.runOnUiThread { activity.performDefaultBack() }
      }
    }

    Function("exitFocusedTask") { surface: String ->
      val activity = focusedReactActivity()?.takeIf { surfaceOf(it) == surface }
      activity?.runOnUiThread {
        if (activity.hasWindowFocus()) activity.performDefaultBack()
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

  private fun stopBackReporting() {
    backListeners.remove(onBack)
    backActivities.clear()
  }

  private fun ReactActivity.performDefaultBack() {
    if (!isDestroyed && !isFinishing) invokeDefaultOnBackPressed()
  }

  companion object {
    @Volatile private var focusedActivity: WeakReference<ReactActivity>? = null
    private val focusListeners = CopyOnWriteArraySet<(String) -> Unit>()
    private val backListeners = CopyOnWriteArraySet<(ReactActivity) -> Unit>()

    // Android can keep both activities resumed in split screen.
    fun onActivityFocused(activity: ReactActivity) {
      focusedActivity = WeakReference(activity)
      focusListeners.forEach { it(surfaceOf(activity)) }
    }

    fun onActivityBackPressed(activity: ReactActivity): Boolean {
      val handler = backListeners.lastOrNull() ?: return false
      handler(activity)
      return true
    }

    private fun surfaceOf(activity: ReactActivity?): String =
      if (activity?.javaClass?.simpleName == "MadoHomuActivity") "madohomu" else "main"
  }
}
