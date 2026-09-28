// The Home Screen widget (WidgetKit, Swift): @bacons/apple-targets turns this folder into an extension target of the
// iPhone project when it is generated (npx expo prebuild; scripts/phone.mjs). Its bundle id is the app's plus
// ".widget"; it shares the App Group app.config.ts declares with the app (that is how it gets the calendar).
/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: "widget",
  name: "GOOYAWidget",
  displayName: "GOOYA",
  bundleIdentifier: ".widget",
  deploymentTarget: "26.0",
  frameworks: ["SwiftUI", "WidgetKit", "AppIntents"],
  colors: {
    $widgetBackground: { light: "#ffffff", dark: "#000000" },
    $accent: { light: "#007aff", dark: "#0a84ff" },
  },
  entitlements: {
    "com.apple.security.application-groups": config.ios?.entitlements?.["com.apple.security.application-groups"] ?? [`group.${config.ios?.bundleIdentifier}`],
  },
});
