import AppKit
import SwiftUI
import WidgetKit

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
    _ = NSApplication.shared
    // iPhone 15 (393 × 852 points): the three Home Screen sizes, and the standard margins.
    let margins = EdgeInsets(top: 16, leading: 16, bottom: 16, trailing: 16)
    var shots: [(String, WidgetFamily, WidgetLayout, CGFloat, CGFloat)] = [
      ("small", .systemSmall, .twoWeeks, 158, 158),
      ("medium", .systemMedium, .twoWeeks, 338, 158),
    ]
    for layout in WidgetLayout.allCases { shots.append(("large-\(layout.rawValue)", .systemLarge, layout, 338, 354)) }
    for (name, family, layout, w, h) in shots {
      for (scheme, label) in [(ColorScheme.dark, "dark"), (ColorScheme.light, "light")] {
        for who in ["both", "me", "other"] {
          if who != "both" && !(name == "large-twoWeeks" && label == "light") { continue }
          let m = WidgetModel(feed: feed, who: who, now: Date(), dark: scheme == .dark)
          let content = WidgetContent(m: m, family: family, layout: layout, margins: margins)
            .frame(width: w, height: h)
            .background(scheme == .dark ? Color.black : Color.white)
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
