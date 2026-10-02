import AppKit
import SwiftUI
import WidgetKit

// Draws the widget's views (targets/widget) at the iPhone's widget sizes and the iPad's extra large one and saves them
// as PNGs, on the Mac, so the layout can be checked without adding the widget to a Home Screen.
// scripts/widget-preview.mjs compiles and runs it:
//   render <output directory> [feed.json, or - for the sample] [a moment to draw it at, as 2026-08-20T12:00:00-04:00]
@main
struct Preview {
  static func main() throws {
    let args = CommandLine.arguments
    let outDir = args.count > 1 ? args[1] : "."
    var feed = FeedStore.sample
    if args.count > 2, args[2] != "-", let data = FileManager.default.contents(atPath: args[2]) {
      feed = try JSONDecoder().decode(Feed.self, from: data)
    }
    let now = args.count > 3 ? ISO8601DateFormatter().date(from: args[3]) ?? Date() : Date()
    _ = NSApplication.shared
    // iPhone 15 (393 × 852 points): the three Home Screen sizes, and the standard margins.
    let margins = EdgeInsets(top: 16, leading: 16, bottom: 16, trailing: 16)
    var shots: [(String, WidgetFamily, WidgetLayout, CGFloat, CGFloat)] = [
      ("small", .systemSmall, .twoWeeks, 158, 158),
      ("medium", .systemMedium, .twoWeeks, 338, 158),
    ]
    for layout in WidgetLayout.allCases { shots.append(("large-\(layout.rawValue)", .systemLarge, layout, 338, 354)) }
    // The iPad's extra large size (an 11-inch iPad Air's on iPadOS 27, 632 × 321 points).
    for layout in WidgetLayout.allCases { shots.append(("xl-\(layout.rawValue)", .systemExtraLarge, layout, 632, 321)) }
    for (name, family, layout, w, h) in shots {
      for (scheme, label) in [(ColorScheme.dark, "dark"), (ColorScheme.light, "light")] {
        for who in ["both", "me", "other"] {
          if who != "both" && !(name == "large-twoWeeks" && label == "light") { continue }
          let m = WidgetModel(feed: feed, who: who, now: now, dark: scheme == .dark)
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
      // The Mac's desktop widget while another app is in front: drawn by opacity alone, grey on the desktop.
      let m = WidgetModel(feed: feed, who: "both", now: now, dark: true)
      let content = WidgetContent(m: m, family: family, layout: layout, margins: margins)
        .frame(width: w, height: h)
        .environment(\.colorScheme, .dark)
        .environment(\.vibrant, true)
      let renderer = ImageRenderer(content: content)
      renderer.scale = 3
      if let cg = renderer.cgImage, let png = dimmed(cg) {
        let path = "\(outDir)/\(name)-both-dimmed.png"
        try png.write(to: URL(fileURLWithPath: path))
        print(path)
      }
    }
  }

  /// What macOS shows of a widget in its grey state: each pixel's opacity sets how light it is over the desktop
  /// (measured on a dimmed desktop widget: #1f1f1f where nothing is drawn, #c6c6c6 where something opaque is).
  static func dimmed(_ cg: CGImage) -> Data? {
    let w = cg.width, h = cg.height
    var px = [UInt8](repeating: 0, count: w * h * 4)
    guard let ctx = CGContext(data: &px, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
    ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
    for i in stride(from: 0, to: px.count, by: 4) {
      let a = Double(px[i + 3]) / 255
      let v = UInt8((31 * (1 - a) + 198 * a).rounded())
      px[i] = v
      px[i + 1] = v
      px[i + 2] = v
      px[i + 3] = 255
    }
    guard let out = ctx.makeImage() else { return nil }
    return NSBitmapImageRep(cgImage: out).representation(using: .png, properties: [:])
  }
}
