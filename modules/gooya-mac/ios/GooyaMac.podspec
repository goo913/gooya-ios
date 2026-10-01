Pod::Spec.new do |s|
  s.name           = 'GooyaMac'
  s.version        = '1.0.0'
  s.summary        = 'GOOYA on the Mac (Mac Catalyst)'
  s.description    = "GOOYA's Mac parts: the menu bar's commands and keyboard shortcuts, the window, the agenda in the Mac's menu bar, and opening at login."
  s.license        = 'UNLICENSED'
  s.author         = 'HyberTec LLC'
  s.homepage       = 'https://github.com/goo913/gooya-ios'
  s.platforms      = { :ios => '26.0' }
  s.source         = { git: 'https://github.com/goo913/gooya-ios.git' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files   = '**/*.{h,m,swift}'
end
