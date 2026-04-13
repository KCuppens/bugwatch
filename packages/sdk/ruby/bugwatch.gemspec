# frozen_string_literal: true

require_relative "lib/bugwatch/version"

Gem::Specification.new do |spec|
  spec.name          = "bugwatch"
  spec.version       = Bugwatch::VERSION
  spec.authors       = ["Bugwatch Team"]
  spec.email         = ["support@bugwatch.dev"]
  spec.summary       = "Official Ruby SDK for Bugwatch - AI-Powered Error Tracking"
  spec.description   = "Capture and report errors from Ruby applications to Bugwatch. Includes integrations for Rack, Rails, and Sidekiq."
  spec.homepage      = "https://bugwatch.dev"
  spec.license       = "FSL-1.1-Apache-2.0"
  spec.required_ruby_version = ">= 3.0"

  spec.metadata = {
    "homepage_uri" => "https://bugwatch.dev",
    "source_code_uri" => "https://github.com/KCuppens/bugwatch",
    "documentation_uri" => "https://bugwatch.dev/docs/sdks/ruby",
    "changelog_uri" => "https://github.com/KCuppens/bugwatch/blob/main/CHANGELOG.md",
    "bug_tracker_uri" => "https://github.com/KCuppens/bugwatch/issues"
  }

  spec.files = Dir["lib/**/*", "README.md", "LICENSE"]
  spec.require_paths = ["lib"]

  spec.add_development_dependency "rack-test", "~> 2.0"
  spec.add_development_dependency "rspec", "~> 3.0"
  spec.add_development_dependency "rubocop", "~> 1.0"
  spec.add_development_dependency "webmock", "~> 3.0"
end
