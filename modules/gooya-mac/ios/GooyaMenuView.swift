import ExpoModulesCore
import UIKit

/// React Native's views with a right-click menu around them (macOS's context menu; Control-click too), as Apple
/// Calendar has on its days and events. `items`: [{ id, title, symbol?, destructive?, disabled?, checked? }] or a group
/// { title?, inline?, children: [...] } (a submenu, or a section between lines). The item chosen comes to `onPick` with
/// where the click was, in this view's points and the window's ({ id, x, y, wx, wy }), so a day's menu can make
/// something at that time, its popover pointing there.
final class GooyaMenuView: ExpoView, UIContextMenuInteractionDelegate {
  let onPick = EventDispatcher()
  var items: [[String: Any]] = []
  private var location = CGPoint.zero

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    addInteraction(UIContextMenuInteraction(delegate: self))
  }

  func contextMenuInteraction(_ interaction: UIContextMenuInteraction, configurationForMenuAtLocation location: CGPoint) -> UIContextMenuConfiguration? {
    guard !items.isEmpty else { return nil }
    self.location = location
    return UIContextMenuConfiguration(identifier: nil, previewProvider: nil) { [weak self] _ in
      guard let self else { return nil }
      return UIMenu(children: self.elements(self.items))
    }
  }

  private func elements(_ list: [[String: Any]]) -> [UIMenuElement] {
    list.map { d in
      let title = d["title"] as? String ?? ""
      let image = (d["symbol"] as? String).flatMap { UIImage(systemName: $0) }
      if let children = d["children"] as? [[String: Any]] {
        return UIMenu(title: title, image: image, options: d["inline"] as? Bool == true ? .displayInline : [], children: elements(children))
      }
      var attributes: UIMenuElement.Attributes = []
      if d["destructive"] as? Bool == true { attributes.insert(.destructive) }
      if d["disabled"] as? Bool == true { attributes.insert(.disabled) }
      let id = d["id"] as? String ?? ""
      return UIAction(title: title, image: image, attributes: attributes, state: d["checked"] as? Bool == true ? .on : .off) { [weak self] _ in
        guard let self else { return }
        let inWindow = self.convert(self.location, to: nil)
        self.onPick(["id": id, "x": self.location.x, "y": self.location.y, "wx": inWindow.x, "wy": inWindow.y])
      }
    }
  }
}
