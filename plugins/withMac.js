// @ts-check
const fs = require("node:fs");
const path = require("node:path");
const { IOSConfig, withAppDelegate, withFinalizedMod, withInfoPlist, withPodfile } = require("expo/config-plugins");

/**
 * GOOYA for Mac: the same app built for the Mac too (Mac Catalyst, optimized for the Mac), from the same project.
 * Listed in app.config.ts's plugins (plain JavaScript: the config can only load plugins that are).
 *
 * - The app and its widget build for Mac Catalyst, under the iPhone app's bundle id (one app on the App Store and in
 *   TestFlight), with the Mac idiom (crisp text at the iPad layout's sizes, which are close to Mac Calendar's).
 * - On the Mac they run sandboxed: entitlements of their own for it (network, the App Group, push, calendars).
 * - Every pod builds for Mac Catalyst at macOS 26 (the app's iOS 26).
 * - React Native's prebuilt React and ReactNativeDependencies frameworks come without the Versions/A layout a framework
 *   in a Mac app must have: a build step just before CocoaPods embeds and signs them reshapes them
 *   (scripts/mac-frameworks.sh).
 * - The app delegate gives the Mac its menus and keyboard shortcuts, and the Settings window its own window (scene)
 *   with React Native in it (modules/gooya-mac). Only the Mac's Info.plist (GOOYA/Info-mac.plist, made from the app's)
 *   allows more than one window (an iPad's GOOYA stays one window), and it gives the Mac Calendar's red as its accent
 *   colour.
 *
 * @typedef {{ appGroup: string | null, push: boolean }} MacOptions appGroup: the App Group the app and the widget share
 *   (null for a free Apple team's build, which has neither); push: push notifications (not on a free team's build).
 */

const APP_TARGET = "GOOYA";
const WIDGET_TARGET = "GOOYAWidget";
const APP_ENTITLEMENTS = "GOOYA/GOOYA-mac.entitlements";
const MAC_INFO = "GOOYA/Info-mac.plist";
const WIDGET_ENTITLEMENTS = "GOOYA/GOOYAWidget-mac.entitlements";

/** @param {Record<string, boolean | string | string[]>} entries */
function plist(entries) {
  const body = Object.entries(entries)
    .map(([key, value]) => {
      const v = typeof value === "boolean" ? `<${value}/>` : Array.isArray(value) ? `<array>${value.map((s) => `<string>${s}</string>`).join("")}</array>` : `<string>${value}</string>`;
      return `\t<key>${key}</key>\n\t${v}`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n${body}\n</dict>\n</plist>\n`;
}

/**
 * The app's and the widget's build settings and entitlements for the Mac: after every other plugin's changes (the
 * widget's target is added by @bacons/apple-targets late).
 * @type {import("expo/config-plugins").ConfigPlugin<MacOptions>}
 */
const withMacProject = (config, options) =>
  withFinalizedMod(config, [
    "ios",
    (c) => {
      const iosRoot = c.modRequest.platformProjectRoot;
      const sandbox = { "com.apple.security.app-sandbox": true, "com.apple.security.network.client": true };
      const group = options.appGroup ? { "com.apple.security.application-groups": [options.appGroup] } : {};
      fs.writeFileSync(
        path.join(iosRoot, APP_ENTITLEMENTS),
        plist({
          ...sandbox,
          ...group,
          ...(options.push ? { "com.apple.developer.aps-environment": "development" } : {}),
          // Apple Reminders (EventKit), when this Mac is the one that syncs them.
          "com.apple.security.personal-information.calendars": true,
        }),
      );
      if (options.appGroup) fs.writeFileSync(path.join(iosRoot, WIDGET_ENTITLEMENTS), plist({ ...sandbox, ...group }));

      // The Mac's accent colour (its Info.plist names it): Apple Calendar's red, for checkboxes, the Settings window's
      // tab and the like, as Calendar has them.
      const accent = path.join(iosRoot, APP_TARGET, "Images.xcassets", "AccentColor.colorset");
      fs.mkdirSync(accent, { recursive: true });
      const srgb = (/** @type {string} */ hex) => ({ "color-space": "srgb", components: { red: `0x${hex.slice(1, 3)}`, green: `0x${hex.slice(3, 5)}`, blue: `0x${hex.slice(5, 7)}`, alpha: "1.000" } });
      const colors = [
        { color: srgb("#FF383C"), idiom: "universal" },
        { appearances: [{ appearance: "luminosity", value: "dark" }], color: srgb("#FF4245"), idiom: "universal" },
      ];
      fs.writeFileSync(path.join(accent, "Contents.json"), JSON.stringify({ colors, info: { author: "xcode", version: 1 } }, null, 2));


      const project = IOSConfig.XcodeUtils.getPbxproj(c.modRequest.projectRoot);
      const targets = project.pbxNativeTargetSection();
      const configurations = project.pbxXCBuildConfigurationSection();
      const lists = project.pbxXCConfigurationList();
      for (const target of Object.values(targets)) {
        if (typeof target !== "object" || !target.name) continue;
        const name = String(target.name).replace(/"/g, "");
        if (name !== APP_TARGET && (name !== WIDGET_TARGET || !options.appGroup)) continue;
        for (const { value } of lists[target.buildConfigurationList]?.buildConfigurations ?? []) {
          const settings = configurations[value]?.buildSettings;
          if (!settings) continue;
          settings.SUPPORTS_MACCATALYST = "YES";
          settings.DERIVE_MACCATALYST_PRODUCT_BUNDLE_IDENTIFIER = "NO";
          settings.TARGETED_DEVICE_FAMILY = '"1,2,6"';
          settings['"CODE_SIGN_ENTITLEMENTS[sdk=macosx*]"'] = `"${name === APP_TARGET ? APP_ENTITLEMENTS : WIDGET_ENTITLEMENTS}"`;
          if (name === APP_TARGET) {
            settings.SUPPORTS_MAC_DESIGNED_FOR_IPHONE_IPAD = "NO";
            settings['"INFOPLIST_FILE[sdk=macosx*]"'] = `"${MAC_INFO}"`;
          }
        }
      }
      fs.writeFileSync(project.filepath, project.writeSync());
      return c;
    },
  ]);

/**
 * Every pod builds for Mac Catalyst too, at the app's iOS 26 (macOS 26), with React Native's Mac Catalyst fixes; and
 * React Native's frameworks are reshaped for the Mac (scripts/mac-frameworks.sh) just before CocoaPods' embed step
 * signs them, so the step is placed once CocoaPods has added its own; and the Mac's Info.plist is made from the app's
 * once React Native's install has written to it.
 * @type {import("expo/config-plugins").ConfigPlugin}
 */
const withMacPods = (config) =>
  withPodfile(config, (c) => {
    let src = c.modResults.contents.replace(":mac_catalyst_enabled => false", ":mac_catalyst_enabled => true");
    const marker = "# GOOYA for Mac (plugins/withMac.js)";
    if (!src.includes(marker)) {
      const anchor = /(\n[ \t]*react_native_post_install\([\s\S]*?\n[ \t]*\)\n)/;
      if (!anchor.test(src)) throw new Error("withMac: the Podfile has no react_native_post_install(…) call to follow; update plugins/withMac.js.");
      src = src.replace(
        anchor,
        `$1    ${marker}: every pod also builds for Mac Catalyst, at the app's iOS 26 (macOS 26).
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |build_config|
        build_config.build_settings['SUPPORTS_MACCATALYST'] = 'YES'
        build_config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '26.0'
      end
    end
  end

  post_integrate do |installer|
    ${marker}: React Native's frameworks reshaped for the Mac, just before CocoaPods embeds and signs them.
    project = installer.aggregate_targets.map(&:user_project).first
    app = project.targets.find { |t| t.name == '${APP_TARGET}' }
    name = '[GOOYA] Shape frameworks for the Mac'
    phase = app.shell_script_build_phases.find { |p| p.name == name } || app.new_shell_script_build_phase(name)
    phase.shell_script = '"\${SRCROOT}/../scripts/mac-frameworks.sh"'
    phase.always_out_of_date = '1'
    app.build_phases.delete(phase)
    embed = app.build_phases.find { |p| p.respond_to?(:name) && p.name == '[CP] Embed Pods Frameworks' }
    app.build_phases.insert(embed ? app.build_phases.index(embed) : app.build_phases.length, phase)
    project.save

    ${marker}: the Mac's Info.plist is the app's as React Native's install left it, with more than one window
    # (GOOYA's and Settings; an iPad's GOOYA stays one window) and Calendar's red for checkboxes and the like.
    info = Xcodeproj::Plist.read_from_path(File.join(project.path.dirname, '${APP_TARGET}', 'Info.plist'))
    info['UIApplicationSceneManifest']['UIApplicationSupportsMultipleScenes'] = true
    info['NSAccentColorName'] = 'AccentColor'
    Xcodeproj::Plist.write_to_path(info, File.join(project.path.dirname, '${MAC_INFO}'))
`,
      );
    }
    c.modResults.contents = src;
    return c;
  });

/**
 * The menus and keyboard shortcuts: the app delegate builds them and passes their commands on; and it gives the
 * Settings window its own window (modules/gooya-mac).
 * @type {import("expo/config-plugins").ConfigPlugin}
 */
const withMacMenus = (config) =>
  withAppDelegate(config, (c) => {
    let src = c.modResults.contents;
    if (!src.includes("GooyaMacMenu")) {
      if (!/\nimport React\n/.test(src)) throw new Error("withMac: AppDelegate.swift no longer imports React; update plugins/withMac.js.");
      src = src.replace(/\nimport React\n/, "\ninternal import GooyaMac\nimport React\n");
      const anchor = /(\n[ \t]*var reactNativeFactory: RCTReactNativeFactory\?\n)/;
      if (!anchor.test(src)) throw new Error("withMac: AppDelegate.swift no longer has reactNativeFactory; update plugins/withMac.js.");
      src = src.replace(
        anchor,
        `$1
#if targetEnvironment(macCatalyst)
  // GOOYA's menus and keyboard shortcuts on the Mac (modules/gooya-mac; plugins/withMac.js).
  override func buildMenu(with builder: UIMenuBuilder) {
    super.buildMenu(with: builder)
    GooyaMacMenu.build(builder)
  }

  override func validate(_ command: UICommand) {
    super.validate(command)
    GooyaMacMenu.validate(command)
  }

  @objc func gooyaCommand(_ command: UICommand) {
    GooyaMacMenu.perform(command)
  }

  // ⌘= for Zoom In, and Escape while there is something to cancel.
  override var keyCommands: [UIKeyCommand]? {
    (super.keyCommands ?? []) + GooyaMacMenu.keyCommands()
  }

  // The Settings window is a window of its own, with React Native in it (GooyaMacSettings); any other is GOOYA's.
  @objc(application:configurationForConnectingSceneSession:options:)
  func application(_ application: UIApplication, configurationForConnecting connectingSceneSession: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration {
    GooyaMacSettings.factory = reactNativeFactory
    return GooyaMacSettings.configuration(for: connectingSceneSession, options: options)
  }
#endif
`,
      );
    }
    c.modResults.contents = src;
    return c;
  });

/**
 * The App Store files a Mac app under a category.
 * @type {import("expo/config-plugins").ConfigPlugin}
 */
const withMacInfo = (config) =>
  withInfoPlist(config, (c) => {
    c.modResults.LSApplicationCategoryType = "public.app-category.productivity";
    return c;
  });

/** @type {import("expo/config-plugins").ConfigPlugin<MacOptions>} */
module.exports = (config, options) => withMacProject(withMacMenus(withMacPods(withMacInfo(config))), options);
