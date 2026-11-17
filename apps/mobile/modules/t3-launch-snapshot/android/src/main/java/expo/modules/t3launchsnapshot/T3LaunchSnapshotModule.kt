package expo.modules.t3launchsnapshot

import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class T3LaunchSnapshotModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("T3LaunchSnapshot")

    Function("capture") { rows: String ->
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        LaunchSnapshotOverlay.capture(appContext.currentActivity, rows)
      }
    }

    Function("showing") {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) LaunchSnapshotOverlay.showing() else null
    }

    Function("hide") {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) LaunchSnapshotOverlay.hide()
    }

    Function("clear") {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) LaunchSnapshotOverlay.clear()
    }
  }
}
