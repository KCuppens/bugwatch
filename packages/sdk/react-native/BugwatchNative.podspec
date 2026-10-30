require 'json'
require 'open3'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

# The Expo Modules API wrapper (ios/expo/*.swift) needs ExpoModulesCore. Only add it when the host
# project has expo-modules-core installed, so bare React Native apps keep a pure Objective-C pod
# (no Swift, no modular-header requirements).
expo_present = begin
  project_root = defined?(Pod::Config) ? Pod::Config.instance.installation_root.to_s : Dir.pwd
  script = "console.log(require.resolve('expo-modules-core/package.json', { paths: [#{project_root.to_json}, #{__dir__.to_json}] }))"
  output, status = Open3.capture2e('node', '-e', script)
  status.success? && !output.strip.empty?
rescue StandardError
  false
end

Pod::Spec.new do |s|
  s.name         = 'BugwatchNative'
  s.version      = package['version']
  s.summary      = 'Native crash capture for the Bugwatch React Native SDK'
  s.description  = 'Captures native iOS crashes (NSException and POSIX signals), persists them to disk and hands them to @bugwatch/react-native on the next launch.'
  s.homepage     = 'https://github.com/KCuppens/bugwatch'
  s.license      = 'FSL-1.1-Apache-2.0'
  s.author       = 'Bugwatch'
  s.platforms    = { :ios => '13.4' }
  s.source       = { :git => 'https://github.com/KCuppens/bugwatch.git', :tag => "v#{s.version}" }

  s.source_files = expo_present ? ['ios/*.{h,m}', 'ios/expo/*.swift'] : ['ios/*.{h,m}']
  s.public_header_files = 'ios/BugwatchCrashHandler.h'
  s.requires_arc = true

  if expo_present
    s.swift_version = '5.4'
    s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
    s.dependency 'ExpoModulesCore'
  end

  if respond_to?(:install_modules_dependencies, true)
    install_modules_dependencies(s)
  else
    s.dependency 'React-Core'
  end
end
