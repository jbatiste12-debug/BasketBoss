# Generate a hosted XCTest target for the real Debug-only purchase bridge checks.
# The shipping App scheme and Release sources remain unchanged.
require 'xcodeproj'

project_path = File.expand_path('../ios/App/App.xcodeproj', __dir__)
project = Xcodeproj::Project.open(project_path)
app = project.targets.find { |target| target.name == 'App' }
abort 'The BasketBoss App target is missing.' unless app
tests = project.targets.find { |target| target.name == 'BasketBossStoreKitTests' } ||
  project.new_target(:unit_test_bundle, 'BasketBossStoreKitTests', :ios, '16.0', nil, :swift)
group = project.main_group['BasketBossStoreKitTests'] ||
  project.main_group.new_group('BasketBossStoreKitTests', 'BasketBossStoreKitTests')
source = group.files.find { |ref| ref.path == 'BasketBossStoreKitTests.swift' } ||
  group.new_file('BasketBossStoreKitTests.swift')
tests.source_build_phase.add_file_reference(source, true)
tests.add_dependency(app) unless tests.dependencies.any? { |dependency| dependency.target == app }
# Xcodeproj's built-in SDK version can lag the selected Xcode. Resolve the
# generated Foundation reference through the actual SDK instead of that version.
tests.frameworks_build_phase.files.each do |build_file|
  reference = build_file.file_ref
  next unless reference && reference.path.end_with?('Foundation.framework')
  reference.path = 'System/Library/Frameworks/Foundation.framework'
  reference.source_tree = 'SDKROOT'
end
tests.build_configurations.each do |config|
  host_config = app.build_configurations.find { |candidate| candidate.name == config.name }
  config.base_configuration_reference = host_config.base_configuration_reference
  config.build_settings.merge!(
    'PRODUCT_NAME' => '$(TARGET_NAME)',
    'PRODUCT_BUNDLE_IDENTIFIER' => 'uk.co.basketboss.app.storekittests',
    'GENERATE_INFOPLIST_FILE' => 'YES',
    'SWIFT_VERSION' => '5.0',
    'TEST_HOST' => '$(BUILT_PRODUCTS_DIR)/App.app/App',
    'BUNDLE_LOADER' => '$(TEST_HOST)',
    'SKIP_INSTALL' => 'YES',
    'TARGETED_DEVICE_FAMILY' => '1,2',
    'ENABLE_TESTING_SEARCH_PATHS' => 'YES',
    'FRAMEWORK_SEARCH_PATHS' => ['$(inherited)', '$(PLATFORM_DIR)/Developer/Library/Frameworks'],
    'LD_RUNPATH_SEARCH_PATHS' => ['$(inherited)', '@executable_path/Frameworks',
                               '@loader_path/Frameworks', '$(PLATFORM_DIR)/Developer/Library/Frameworks']
  )
end
attributes = project.root_object.attributes['TargetAttributes'] ||= {}
attributes[tests.uuid] = { 'TestTargetID' => app.uuid }
project.save
scheme = Xcodeproj::XCScheme.new
scheme.configure_with_targets(app, tests, launch_target: true)
scheme.test_action.build_configuration = 'Debug'
scheme.test_action.testables.each { |testable| testable.parallelizable = false }
scheme.save_as(project.path, 'BasketBossStoreKitTests', true)
puts 'Hosted BasketBoss StoreKit XCTest target is ready.'
