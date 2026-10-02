import UIKit

#if targetEnvironment(macCatalyst)
/// The Mac window as Apple Calendar's: the sidebar (macOS's own, its edge dragged wider, narrower or closed, and open
/// again from the window's edge) beside the calendar. The window's content (React Native's) becomes the split view's
/// second column once the calendar shows.
enum GooyaMacSplit {
  static weak var split: UISplitViewController?
  static let sidebar = GooyaMacSidebarController()
  private static let widthKey = "GooyaMacSidebarWidth"
  private static let hiddenKey = "GooyaMacSidebarHidden"

  /// What JavaScript last asked for, applied once its requests settle (a remount asks off and on at once).
  private static var wanted: Bool?
  /// Signing in: no sidebar (the split stays; taking the content out of it again loses it).
  private static var suppressed = false
  static var isSuppressed: Bool { suppressed }

  /// The calendar shows (true) or not (signing in): the sidebar beside it, or the content alone.
  static func setShown(_ shown: Bool) {
    let first = wanted == nil
    wanted = shown
    guard first else { return }
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
      guard let shown = wanted else { return }
      wanted = nil
      for case let scene as UIWindowScene in UIApplication.shared.connectedScenes where !GooyaMacSettings.isSettings(scene) {
        guard let window = scene.keyWindow ?? scene.windows.first else { continue }
        if shown {
          let fresh = !(window.rootViewController is UISplitViewController)
          attach(window)
          if !fresh, suppressed, !UserDefaults.standard.bool(forKey: hiddenKey), let split { open(split, true) }
          suppressed = false
          split?.view.setNeedsLayout()
        } else if let split {
          suppressed = true
          open(split, false)
          split.view.setNeedsLayout()
        }
      }
    }
  }

  private static func attach(_ window: UIWindow) {
    if let split = window.rootViewController as? UISplitViewController {
      self.split = split
      return
    }
    guard let content = window.rootViewController else { return }
    let split = GooyaSplitViewController(style: .doubleColumn)
    split.primaryBackgroundStyle = .sidebar
    split.preferredSplitBehavior = .tile
    split.presentsWithGesture = false
    split.displayModeButtonVisibility = .never
    let saved = UserDefaults.standard.double(forKey: widthKey)
    split.pin(saved >= GooyaSplitViewController.least ? saved : 220)
    split.preferredDisplayMode = UserDefaults.standard.bool(forKey: hiddenKey) ? .secondaryOnly : .oneBesideSecondary
    window.rootViewController = split
    split.setViewController(sidebar, for: .primary)
    split.setViewController(content, for: .secondary)
    for column in [UISplitViewController.Column.primary, .secondary] {
      split.viewController(for: column)?.navigationController?.isNavigationBarHidden = true
    }
    self.split = split
  }

  /// View → Show/Hide Calendar List.
  static func toggle() {
    guard let split, !suppressed else { return }
    open(split, split.displayMode == .secondaryOnly)
  }

  /// The sidebar shown beside the calendar, or closed.
  static func open(_ split: UISplitViewController, _ shown: Bool) {
    split.preferredDisplayMode = shown ? .oneBesideSecondary : .secondaryOnly
  }

  static var isShown: Bool {
    guard let split else { return false }
    return split.displayMode != .secondaryOnly
  }

  /// Remembers the sidebar's width and whether it is closed, for the next launch (not while signing in).
  static func remember(_ split: GooyaSplitViewController) {
    if suppressed { return }
    UserDefaults.standard.set(split.displayMode == .secondaryOnly, forKey: hiddenKey)
    UserDefaults.standard.set(split.width, forKey: widthKey)
  }
}

final class GooyaSplitViewController: UISplitViewController {
  private var lastShown: Bool?
  /// The sidebar's width (kept by pinning the column's least and most widths to it, so macOS's own divider, which
  /// remembers where it was dragged, never overrides it).
  private(set) var width: CGFloat = 220
  /// Over the sidebar's edge (the window's left edge while it is closed): dragging it makes the sidebar wider or
  /// narrower, closes it past the least width and opens it again from the window's edge, as Calendar's does.
  private let grip = UIView()
  private var dragFrom: CGFloat = 0
  private var resizeCursor: AnyObject?
  /// Calendar's least and most sidebar widths, and how far past the least it is dragged before it closes.
  static let least: CGFloat = 160
  static let most: CGFloat = 400
  private static let closeBelow: CGFloat = 100

  func pin(_ w: CGFloat) {
    width = max(Self.least, min(Self.most, w))
    minimumPrimaryColumnWidth = width
    maximumPrimaryColumnWidth = width
    preferredPrimaryColumnWidth = width
  }

  override func viewDidLoad() {
    super.viewDidLoad()
    grip.backgroundColor = .clear
    grip.addGestureRecognizer(UIPanGestureRecognizer(target: self, action: #selector(dragGrip(_:))))
    grip.addGestureRecognizer(UIHoverGestureRecognizer(target: self, action: #selector(hoverGrip(_:))))
    view.addSubview(grip)
  }

  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    adoptStrayRoot()
    let closed = displayMode == .secondaryOnly
    grip.isHidden = GooyaMacSplit.isSuppressed
    let top = view.safeAreaInsets.top
    grip.frame = CGRect(x: closed ? 0 : primaryColumnWidth - 4, y: top, width: closed ? 8 : 8, height: max(0, view.bounds.height - top))
    view.bringSubviewToFront(grip)
    GooyaMacSplit.remember(self)
    let shown = !closed
    if shown != lastShown {
      lastShown = shown
      GooyaMacMenu.sidebar = shown
      UIMenuSystem.main.setNeedsRevalidate()
      GooyaMacModule.current?.sendEvent("onSidebar", ["type": "shown", "shown": shown])
    }
  }

  @objc private func dragGrip(_ pan: UIPanGestureRecognizer) {
    let x = pan.location(in: view).x
    switch pan.state {
    case .began:
      dragFrom = displayMode == .secondaryOnly ? 0 : width
    case .changed:
      // Live: narrower than the least by enough, it closes; dragged back out, it opens at the pointer.
      if x < Self.closeBelow {
        if displayMode != .secondaryOnly { GooyaMacSplit.open(self, false) }
      } else {
        pin(x)
        if displayMode == .secondaryOnly { GooyaMacSplit.open(self, true) }
      }
    default:
      view.setNeedsLayout()
    }
  }

  /// The ↔ pointer over the edge, as macOS shows over a split view's divider.
  @objc private func hoverGrip(_ hover: UIHoverGestureRecognizer) {
    guard let cursorClass = NSClassFromString("NSCursor") as? NSObject.Type else { return }
    switch hover.state {
    case .began, .changed:
      if let cursor = cursorClass.value(forKey: "resizeLeftRightCursor") as? NSObject {
        cursor.perform(NSSelectorFromString("set"))
        resizeCursor = cursor
      }
    default:
      (cursorClass.value(forKey: "arrowCursor") as? NSObject)?.perform(NSSelectorFromString("set"))
      resizeCursor = nil
    }
  }

  /// A development build reloading its JavaScript puts React Native's new root view on the window's root controller,
  /// which is this one: it belongs in the calendar's column, under the sidebar.
  private func adoptStrayRoot() {
    guard let stray = view.subviews.first(where: { NSStringFromClass(type(of: $0)).hasPrefix("RCT") }), let owner = stray.next as? UIViewController, owner !== viewController(for: .secondary) else { return }
    // Its controller becomes the column's content (after this layout pass).
    DispatchQueue.main.async { [weak self] in
      guard let self, stray.superview === self.view else { return }
      stray.removeFromSuperview()
      self.setViewController(owner, for: .secondary)
      self.viewController(for: .secondary)?.navigationController?.isNavigationBarHidden = true
    }
  }
}

#endif
