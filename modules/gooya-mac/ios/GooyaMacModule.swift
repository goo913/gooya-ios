import ExpoModulesCore
import UIKit
#if targetEnvironment(macCatalyst)
import ServiceManagement
#endif

/// GOOYA's Mac parts for JavaScript (modules/gooya-mac/index.ts): whether this is the Mac, the window's sidebar, the
/// menus' state and commands, the agenda in the Mac's menu bar, and opening at login. On an iPhone or iPad it does
/// nothing.
public class GooyaMacModule: Module {
  static weak var current: GooyaMacModule?
  /// GOOYA's window is the key window (in front).
  static var windowActive = true
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

    Events("onCommand", "onAgendaSelect", "onSidebar", "onWindowActive")

    OnCreate {
      GooyaMacModule.current = self
      #if targetEnvironment(macCatalyst)
      // The window in front or not (Apple greys today's circle and what is chosen while it is not).
      // GOOYA's window only (the Settings window's title is its tab's; GOOYA's is "GOOYA"): Settings in front makes the
      // calendar inactive, as Calendar's Settings does.
      for (name, active) in [("NSWindowDidBecomeKeyNotification", true), ("NSWindowDidResignKeyNotification", false)] {
        NotificationCenter.default.addObserver(forName: Notification.Name(name), object: nil, queue: .main) { [weak self] note in
          guard (note.object as? NSObject)?.value(forKey: "title") as? String == "GOOYA" else { return }
          GooyaMacModule.windowActive = active
          self?.sendEvent("onWindowActive", ["active": active])
        }
      }
      DispatchQueue.main.async {
        let app = (NSClassFromString("NSApplication") as? NSObject.Type)?.value(forKey: "sharedApplication") as? NSObject
        GooyaMacModule.windowActive = app?.value(forKey: "keyWindow") != nil
      }
      #endif
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

    Function("setMenuState") { (view: String) in
      GooyaMacMenu.view = view
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

    Function("setSplit") { (shown: Bool) in
      #if targetEnvironment(macCatalyst)
      DispatchQueue.main.async { GooyaMacSplit.setShown(shown) }
      #endif
    }

    Function("setSidebar") { (sections: [[String: Any]], today: String) in
      #if targetEnvironment(macCatalyst)
      DispatchQueue.main.async {
        GooyaMacSplit.sidebar.update(sections)
        GooyaMacSplit.sidebar.month.set(today: today)
      }
      #endif
    }

    Function("setEscape") { (on: Bool) in
      DispatchQueue.main.async { GooyaMacMenu.escape = on }
    }

    Function("openSettings") { (tab: String?) in
      #if targetEnvironment(macCatalyst)
      DispatchQueue.main.async { GooyaMacSettings.open(tab) }
      #endif
    }

    Function("closeSettings") {
      #if targetEnvironment(macCatalyst)
      DispatchQueue.main.async { GooyaMacSettings.close() }
      #endif
    }

    Function("setSettingsSize") { (tab: String, width: Double, height: Double) in
      #if targetEnvironment(macCatalyst)
      DispatchQueue.main.async { GooyaMacSettings.setSize(CGSize(width: ceil(width), height: ceil(height)), for: tab) }
      #endif
    }

    Function("showMainWindow") {
      #if targetEnvironment(macCatalyst)
      DispatchQueue.main.async { GooyaMacSettings.showMain() }
      #endif
    }

    View(GooyaControlView.self) {
      Events("onAction", "onMeasure")
      Prop("kind") { (view: GooyaControlView, kind: String) in view.kind = kind }
      Prop("title") { (view: GooyaControlView, title: String) in view.title = title }
      Prop("options") { (view: GooyaControlView, options: [String]) in view.options = options }
      Prop("selected") { (view: GooyaControlView, selected: Int) in view.selected = selected }
      Prop("checked") { (view: GooyaControlView, checked: Bool) in view.checked = checked }
      Prop("enabled") { (view: GooyaControlView, enabled: Bool) in view.enabled = enabled }
      Prop("stretch") { (view: GooyaControlView, stretch: Bool) in view.stretch = stretch }
      OnViewDidUpdateProps { (view: GooyaControlView) in view.update() }
    }

    Function("windowActive") { () -> Bool in
      GooyaMacModule.windowActive
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
