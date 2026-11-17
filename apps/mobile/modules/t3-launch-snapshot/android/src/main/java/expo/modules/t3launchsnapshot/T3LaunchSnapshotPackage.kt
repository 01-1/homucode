package expo.modules.t3launchsnapshot

import android.app.Application
import android.content.Context
import android.os.Build
import expo.modules.core.interfaces.ApplicationLifecycleListener
import expo.modules.core.interfaces.Package

class T3LaunchSnapshotPackage : Package {
  override fun createApplicationLifecycleListeners(
    context: Context
  ): List<ApplicationLifecycleListener> = listOf(
    object : ApplicationLifecycleListener {
      override fun onCreate(application: Application) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
          LaunchSnapshotOverlay.install(application)
        }
      }
    }
  )
}
