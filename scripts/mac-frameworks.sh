#!/bin/sh
# GOOYA for Mac: a framework in a Mac app keeps its files in Versions/A, with links to them. React Native's prebuilt
# React and ReactNativeDependencies come flattened or shaped for iOS (and React Native extracts them again whenever
# Debug and Release alternate), so after the frameworks are copied into the Mac app this reshapes them and signs them
# again. The app's last build step (the Podfile's post_integrate, from plugins/withMac.js); nothing for iPhone builds.
[ "${EFFECTIVE_PLATFORM_NAME:-}" = "-maccatalyst" ] || exit 0

# merge <from> <to>: moves a file or folder in, keeping what is already there (a flattened copy duplicates it).
merge() {
  local item
  if [ -d "$1" ] && [ ! -L "$1" ] && [ -d "$2" ]; then
    for item in $(ls -A "$1"); do merge "$1/$item" "$2/$item"; done
    rm -rf "$1"
  elif [ -e "$2" ]; then
    rm -rf "$1"
  else
    mv "$1" "$2"
  fi
}

for fw in "${TARGET_BUILD_DIR}/${FRAMEWORKS_FOLDER_PATH}"/*.framework; do
  name=$(basename "$fw" .framework)
  [ -L "$fw/$name" ] && [ -L "$fw/Versions/Current" ] && continue
  [ -e "$fw/$name" ] || continue
  a="$fw/Versions/A"
  mkdir -p "$a/Resources"
  if [ -d "$fw/Versions/Current" ] && [ ! -L "$fw/Versions/Current" ]; then merge "$fw/Versions/Current" "$a"; fi
  [ -L "$fw/Versions/Current" ] || ln -s A "$fw/Versions/Current"
  for e in $(ls -A "$fw"); do
    p="$fw/$e"
    [ "$e" = "Versions" ] && continue
    [ -L "$p" ] && continue
    case "$e" in
      "$name" | Resources) merge "$p" "$a/$e"; ln -s "Versions/Current/$e" "$p" ;;
      _CodeSignature | Headers | PrivateHeaders | Modules) rm -rf "$p" ;;
      *) merge "$p" "$a/Resources/$e" ;; # Info.plist, resource bundles, privacy manifests
    esac
  done
  [ -e "$fw/Resources" ] || ln -s Versions/Current/Resources "$fw/Resources"
  echo "Reshaped $name.framework for the Mac"
  if [ -n "${EXPANDED_CODE_SIGN_IDENTITY:-}" ] && [ "${CODE_SIGNING_ALLOWED:-YES}" != "NO" ]; then
    /usr/bin/codesign --force --sign "${EXPANDED_CODE_SIGN_IDENTITY}" ${OTHER_CODE_SIGN_FLAGS:-} --preserve-metadata=identifier,entitlements "$fw"
  fi
done
