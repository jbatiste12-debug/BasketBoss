# Generate a separate UI-testing runner. No test target or test entrypoint is
# included in the shipping App scheme or Release build.
require 'xcodeproj'

project_path = File.expand_path('../ios/App/App.xcodeproj', __dir__)
project = Xcodeproj::Project.open(project_path)
app = project.targets.find { |target| target.name == 'App' }
abort 'The BasketBoss App target is missing.' unless app
tests = project.targets.find { |target| target.name == 'BasketBossAccountKeyboardUITests' } ||
  project.new_target(:ui_test_bundle, 'BasketBossAccountKeyboardUITests', :ios, '16.0', nil, :swift)
group = project.main_group['BasketBossAccountKeyboardUITests'] ||
  project.main_group.new_group('BasketBossAccountKeyboardUITests', 'BasketBossAccountKeyboardUITests')
source = group.files.find { |ref| ref.path == 'BasketBossAccountKeyboardUITests.swift' } ||
  group.new_file('BasketBossAccountKeyboardUITests.swift')
tests.source_build_phase.add_file_reference(source, true)
tests.add_dependency(app) unless tests.dependencies.any? { |dependency| dependency.target == app }
tests.frameworks_build_phase.files.each do |build_file|
  reference = build_file.file_ref
  next unless reference && reference.path.end_with?('Foundation.framework')
  reference.path = 'System/Library/Frameworks/Foundation.framework'
  reference.source_tree = 'SDKROOT'
end
tests.build_configurations.each do |config|
  # This is a standalone XCTestRunner, not a hosted bundle. App CocoaPods flags
  # would link frameworks into the runner without its own embedding phase.
  config.base_configuration_reference = nil
  config.build_settings.delete('TEST_HOST')
  config.build_settings.delete('BUNDLE_LOADER')
  config.build_settings.merge!(
    'PRODUCT_NAME' => '$(TARGET_NAME)',
    'PRODUCT_BUNDLE_IDENTIFIER' => 'uk.co.basketboss.app.accountkeyboardtests',
    'GENERATE_INFOPLIST_FILE' => 'YES',
    'SWIFT_VERSION' => '5.0',
    'TEST_TARGET_NAME' => 'App',
    'SKIP_INSTALL' => 'YES',
    'TARGETED_DEVICE_FAMILY' => '1,2',
    'ENABLE_TESTING_SEARCH_PATHS' => 'YES',
    'FRAMEWORK_SEARCH_PATHS' => ['$(inherited)', '$(PLATFORM_DIR)/Developer/Library/Frameworks'],
    'LD_RUNPATH_SEARCH_PATHS' => ['$(inherited)', '@executable_path/Frameworks', '@loader_path/Frameworks']
  )
end
attributes = project.root_object.attributes['TargetAttributes'] ||= {}
attributes[tests.uuid] = { 'TestTargetID' => app.uuid }
project.save
scheme = Xcodeproj::XCScheme.new
scheme.configure_with_targets(app, tests, launch_target: true)
scheme.test_action.build_configuration = 'Debug'
scheme.test_action.testables.each { |testable| testable.parallelizable = false }
scheme.save_as(project.path, 'BasketBossAccountKeyboardUITests', true)
puts 'BasketBoss account keyboard XCUITest target is ready.'
