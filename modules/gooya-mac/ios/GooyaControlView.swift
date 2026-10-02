import ExpoModulesCore
import UIKit

/// A control the Mac draws itself (AppKit's look, in the Mac idiom), for React Native's Settings window: a
/// "checkbox" (with its title), a "popup" (`options`, `selected`: the pop-up button with ⌃⌄), a "pulldown" (a button
/// with a menu of `options`) or a "button" (a push button). `onAction` gives { checked } or { index } ({} for a
/// button); `onMeasure` gives the control's own size, for its place in the layout. On an iPhone or iPad it is UIKit's.
final class GooyaControlView: ExpoView {
  let onAction = EventDispatcher()
  let onMeasure = EventDispatcher()

  var kind = "checkbox"
  var title = ""
  var options: [String] = []
  var selected = -1
  var checked = false
  var enabled = true
  /// Fills the view's width (a pop-up button as wide as the others in its column), instead of its own width.
  var stretch = false
  private var control: UIControl?
  private var builtKind = ""
  private var measured = CGSize.zero

  func update() {
    if builtKind != kind || control == nil { build() }
    switch control {
    case let toggle as UISwitch:
      toggle.title = title
      if toggle.isOn != checked { toggle.setOn(checked, animated: false) }
    case let button as UIButton:
      if kind == "button" {
        button.setTitle(title, for: .normal)
      } else {
        button.menu = menu()
        if kind == "pulldown" { button.setTitle(title, for: .normal) }
      }
    default:
      break
    }
    control?.isEnabled = enabled
    measure()
    setNeedsLayout()
  }

  private func build() {
    control?.removeFromSuperview()
    builtKind = kind
    let made: UIControl
    switch kind {
    case "popup", "pulldown":
      let button = UIButton(type: .system)
      button.showsMenuAsPrimaryAction = true
      button.changesSelectionAsPrimaryAction = kind == "popup"
      made = button
    case "button":
      let button = UIButton(type: .system)
      button.addAction(UIAction { [weak self] _ in self?.onAction([:]) }, for: .primaryActionTriggered)
      made = button
    default:
      let toggle = UISwitch()
      #if targetEnvironment(macCatalyst)
      toggle.preferredStyle = .checkbox
      #endif
      toggle.addAction(UIAction { [weak self, weak toggle] _ in self?.onAction(["checked": toggle?.isOn ?? false]) }, for: .valueChanged)
      made = toggle
    }
    addSubview(made)
    control = made
  }

  private func menu() -> UIMenu {
    UIMenu(children: options.enumerated().map { index, title in
      UIAction(title: title, state: kind == "popup" && index == selected ? .on : .off) { [weak self] _ in self?.onAction(["index": index]) }
    })
  }

  private func fit() -> CGSize {
    guard let control else { return .zero }
    let size = control.sizeThatFits(CGSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude))
    return CGSize(width: ceil(size.width), height: ceil(size.height))
  }

  private func measure() {
    let size = fit()
    guard size != measured, size.width > 0 else { return }
    measured = size
    onMeasure(["width": size.width, "height": size.height])
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    guard let control else { return }
    let size = fit()
    let width = stretch ? bounds.width : size.width
    control.frame = CGRect(x: 0, y: ((bounds.height - size.height) / 2).rounded(), width: width, height: size.height)
  }
}
