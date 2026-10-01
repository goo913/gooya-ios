import ExpoModulesCore
import UIKit
#if targetEnvironment(macCatalyst)
import ServiceManagement
#endif

/// GOOYA's Mac parts for JavaScript (modules/gooya-mac/index.ts): whether this is the Mac, the menus' state and
/// commands, the agenda in the Mac's menu bar, and opening at login. On an iPhone or iPad it does nothing.
public class GooyaMacModule: Module {
  static weak var current: GooyaMacModule?
  /// A row of the menu bar's agenda chosen before JavaScript was listening (GOOYA opened from it).
  private var pendingSelection: String?
  private var listening = false

  public func definition() -> ModuleDefinition {
    Name("GooyaMac")

    Constant("isMac") { () -> Bool in
      #if targetEnvironment(macCatalyst)
      return true
      #else
      return false
      #endif
    }

    Events("onCommand", "onAgendaSelect")

    OnCreate {
      GooyaMacModule.current = self
      DispatchQueue.main.async {
        GooyaMacWindow.start()
        GooyaStatusItem.shared().onSelect = { [weak self] key in
          GooyaMacWindow.bringForward()
          self?.select(key)
        }
      }
    }

    OnStartObserving("onAgendaSelect") {
      self.listening = true
      if let key = self.pendingSelection {
        self.pendingSelection = nil
        self.sendEvent("onAgendaSelect", ["key": key])
      }
    }

    OnStopObserving("onAgendaSelect") {
      self.listening = false
    }

    Function("setMenuState") { (view: String, sidebar: Bool) in
      GooyaMacMenu.view = view
      GooyaMacMenu.sidebar = sidebar
      DispatchQueue.main.async {
        UIMenuSystem.main.setNeedsRevalidate()
        #if targetEnvironment(macCatalyst)
        GooyaMacToolbar.shared.refresh()
        #endif
      }
    }

    Function("setAgenda") { (sections: [[String: Any]], actions: [[String: Any]]) in
      #if targetEnvironment(macCatalyst)
      DispatchQueue.main.async { GooyaStatusItem.shared().show(withSections: sections, actions: actions) }
      #endif
    }

    Function("hideAgenda") {
      #if targetEnvironment(macCatalyst)
      DispatchQueue.main.async { GooyaStatusItem.shared().hide() }
      #endif
    }

    Function("setToolbar") { (shown: Bool) in
      DispatchQueue.main.async { GooyaMacWindow.setToolbar(shown) }
    }

    Function("bringForward") {
      DispatchQueue.main.async { GooyaMacWindow.bringForward() }
    }

    Function("openAtLogin") { () -> Bool in
      #if targetEnvironment(macCatalyst)
      return SMAppService.mainApp.status == .enabled
      #else
      return false
      #endif
    }

    AsyncFunction("setOpenAtLogin") { (on: Bool) -> Bool in
      #if targetEnvironment(macCatalyst)
      let service = SMAppService.mainApp
      if on {
        // Registered again from this copy of GOOYA, so login opens this one (not another build that registered).
        if service.status == .enabled { try? service.unregister() }
        try service.register()
      } else if service.status == .enabled {
        try service.unregister()
      }
      return service.status == .enabled
      #else
      return false
      #endif
    }
  }

  private func select(_ key: String) {
    if listening {
      sendEvent("onAgendaSelect", ["key": key])
    } else {
      pendingSelection = key
    }
  }
}
