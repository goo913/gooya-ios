Pod::Spec.new do |s|
  s.name           = 'GooyaReminders'
  s.version        = '1.0.0'
  s.summary        = 'Apple Reminders for GOOYA (EventKit)'
  s.description    = 'Reads and changes the reminders on the iPhone for GOOYA: lists, reminders, moving between lists, alarms at the due time, and change notifications.'
  s.license        = 'UNLICENSED'
  s.author         = 'HyberTec LLC'
  s.homepage       = 'https://github.com/goo913/gooya-ios'
  s.platforms      = { :ios => '26.0' }
  s.source         = { git: 'https://github.com/goo913/gooya-ios.git' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks     = 'EventKit'
  s.source_files   = '**/*.{h,m,swift}'
end
