import UIKit

#if targetEnvironment(macCatalyst)
/// The Mac window's toolbar, after Apple Calendar's (macOS 27): over the sidebar only the window's buttons; + where the
/// calendar starts (it follows the sidebar's edge), Day · Week · Month · Year in the middle of the calendar, Search at
/// the right. Its buttons send the same commands as the menus (`onCommand`); the views' selection follows
/// `GooyaMacMenu.view`.
final class GooyaMacToolbar: NSObject, NSToolbarDelegate {
  static let shared = GooyaMacToolbar()

  private let add = NSToolbarItem.Identifier("gooya.add")
  private let views = NSToolbarItem.Identifier("gooya.views")
  private let search = NSToolbarItem.Identifier("gooya.search")
  private static let viewNames = ["day", "week", "month", "year"]
  private var groups: [NSToolbarItemGroup] = []

  /// A new toolbar for a window.
  func make() -> NSToolbar {
    let toolbar = NSToolbar(identifier: "GOOYA")
    toolbar.delegate = self
    toolbar.displayMode = .iconOnly
    toolbar.allowsUserCustomization = false
    return toolbar
  }

  /// Shows the view `GooyaMacMenu.view` as chosen.
  func refresh() {
    let index = GooyaMacToolbar.viewNames.firstIndex(of: GooyaMacMenu.view) ?? 2
    for group in groups where group.selectedIndex != index { group.selectedIndex = index }
  }

  func toolbarDefaultItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] {
    // The views centred between + and Search, as Apple's are (over the calendar, not the window).
    [.primarySidebarTrackingSeparatorItemIdentifier, add, .flexibleSpace, views, .flexibleSpace, search]
  }

  func toolbarAllowedItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] {
    toolbarDefaultItemIdentifiers(toolbar)
  }

  func toolbar(_ toolbar: NSToolbar, itemForItemIdentifier id: NSToolbarItem.Identifier, willBeInsertedIntoToolbar flag: Bool) -> NSToolbarItem? {
    switch id {
    case add: return button(id, symbol: "plus", label: "New Schedule or Task")
    case search: return button(id, symbol: "magnifyingglass", label: "Search")
    case views:
      let group = NSToolbarItemGroup(itemIdentifier: id, titles: ["Day", "Week", "Month", "Year"], selectionMode: .selectOne, labels: ["Day", "Week", "Month", "Year"], target: self, action: #selector(pickView(_:)))
      group.selectedIndex = GooyaMacToolbar.viewNames.firstIndex(of: GooyaMacMenu.view) ?? 2
      groups.append(group)
      return group
    default: return nil
    }
  }

  private func button(_ id: NSToolbarItem.Identifier, symbol: String, label: String) -> NSToolbarItem {
    let item = NSToolbarItem(itemIdentifier: id)
    item.image = UIImage(systemName: symbol)
    item.label = label
    item.toolTip = label
    item.isBordered = true
    item.target = self
    item.action = #selector(press(_:))
    return item
  }

  @objc private func press(_ item: NSToolbarItem) {
    GooyaMacModule.current?.sendEvent("onCommand", ["id": item.itemIdentifier == add ? "new" : "search"])
  }

  @objc private func pickView(_ group: NSToolbarItemGroup) {
    guard GooyaMacToolbar.viewNames.indices.contains(group.selectedIndex) else { return }
    GooyaMacModule.current?.sendEvent("onCommand", ["id": "view.\(GooyaMacToolbar.viewNames[group.selectedIndex])"])
  }
}
#endif
