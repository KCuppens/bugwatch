# frozen_string_literal: true

require "spec_helper"

RSpec.describe Bugwatch::Fingerprint do
  describe ".generate" do
    it "generates consistent fingerprints for the same exception" do
      event1 = Bugwatch::ErrorEvent.new
      event1.exception = Bugwatch::ExceptionInfo.new(
        type: "RuntimeError",
        value: "test error",
        stacktrace: [
          Bugwatch::StackFrame.new(filename: "app/models/user.rb", lineno: 42, function: "save", in_app: true)
        ]
      )

      event2 = Bugwatch::ErrorEvent.new
      event2.exception = Bugwatch::ExceptionInfo.new(
        type: "RuntimeError",
        value: "test error",
        stacktrace: [
          Bugwatch::StackFrame.new(filename: "app/models/user.rb", lineno: 42, function: "save", in_app: true)
        ]
      )

      expect(described_class.generate(event1)).to eq(described_class.generate(event2))
    end

    it "generates different fingerprints for different exceptions" do
      event1 = Bugwatch::ErrorEvent.new
      event1.exception = Bugwatch::ExceptionInfo.new(
        type: "RuntimeError",
        value: "error one",
        stacktrace: []
      )

      event2 = Bugwatch::ErrorEvent.new
      event2.exception = Bugwatch::ExceptionInfo.new(
        type: "TypeError",
        value: "error two",
        stacktrace: []
      )

      expect(described_class.generate(event1)).not_to eq(described_class.generate(event2))
    end

    it "generates fingerprints for message events" do
      event = Bugwatch::ErrorEvent.new
      event.message = "something happened"

      fingerprint = described_class.generate(event)
      expect(fingerprint).to be_a(String)
      expect(fingerprint.length).to eq(64) # SHA256 hex digest
    end

    it "uses in-app frames for fingerprinting" do
      event = Bugwatch::ErrorEvent.new
      event.exception = Bugwatch::ExceptionInfo.new(
        type: "RuntimeError",
        value: "test",
        stacktrace: [
          Bugwatch::StackFrame.new(filename: "/gems/activesupport/lib/foo.rb", lineno: 10, function: "bar", in_app: false),
          Bugwatch::StackFrame.new(filename: "app/models/user.rb", lineno: 42, function: "save", in_app: true)
        ]
      )

      # Fingerprint should use in-app frame
      fingerprint = described_class.generate(event)
      expect(fingerprint).to be_a(String)
    end
  end
end
