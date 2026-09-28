import AppKit
import SwiftUI

// Draws the widget's views (targets/widget) at the iPhone's widget sizes and saves them as PNGs, on the Mac, so the
// layout can be checked without adding the widget to a Home Screen. scripts/widget-preview.mjs compiles and runs it:
//   render <output directory> [feed.json]
@main
struct Preview {
  static func main() throws {
    let args = CommandLine.arguments
    let outDir = args.count > 1 ? args[1] : "."
    var feed = FeedStore.sample
    if args.count > 2, let data = FileManager.default.contents(atPath: args[2]) {
      feed = try JSONDecoder().decode(Feed.self, from: data)
    }
    let app = NSApplication.shared
    // iPhone 17 Pro (402 × 874 points): the three Home Screen sizes.
    let sizes: [(String, CGFloat, CGFloat)] = [("small", 158, 158), ("medium", 338, 158), ("large", 338, 354)]
    for (name, w, h) in sizes {
      for (scheme, label) in [(ColorScheme.dark, "dark"), (ColorScheme.light, "light")] {
        for who in ["both", "me", "other"] {
          if who != "both" && !(name == "medium" && label == "dark") { continue }
          let m = WidgetModel(feed: feed, who: who, now: Date())
          let body: AnyView = name == "small" ? AnyView(SmallView(m: m)) : name == "medium" ? AnyView(MediumView(m: m)) : AnyView(LargeView(m: m))
          app.appearance = NSAppearance(named: scheme == .dark ? .darkAqua : .aqua)
          let content = body
            .padding(16)
            .frame(width: w, height: h)
            .background(Color(light: "#ffffff", dark: "#000000"))
            .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
            .environment(\.colorScheme, scheme)
          let renderer = ImageRenderer(content: content)
          renderer.scale = 3
          guard let cg = renderer.cgImage else {
            print("could not draw \(name)")
            continue
          }
          let rep = NSBitmapImageRep(cgImage: cg)
          guard let png = rep.representation(using: .png, properties: [:]) else { continue }
          let path = "\(outDir)/\(name)-\(who)-\(label).png"
          try png.write(to: URL(fileURLWithPath: path))
          print(path)
        }
      }
    }
  }
}
