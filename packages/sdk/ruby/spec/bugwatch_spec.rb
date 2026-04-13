# frozen_string_literal: true

require "spec_helper"

RSpec.describe Bugwatch do
  let(:mock_transport) { instance_double(Bugwatch::NoopTransport, send_event: nil, flush: nil, close: nil) }

  before do
    allow(Bugwatch::HttpTransport).to receive(:new).and_return(mock_transport)
  end

  describe ".init" do
    it "initializes with an API key" do
      Bugwatch.init(api_key: "test-key")
      expect(Bugwatch.configured?).to be true
    end

    it "is not configured without an API key" do
      expect(Bugwatch.configured?).to be false
    end
  end

  describe ".configure" do
    it "yields the configuration" do
      Bugwatch.configure do |config|
        config.api_key = "test-key"
        config.environment = "test"
      end

      expect(Bugwatch.configuration.api_key).to eq("test-key")
      expect(Bugwatch.configuration.environment).to eq("test")
      expect(Bugwatch.configured?).to be true
    end
  end

  describe ".capture_exception" do
    before do
      Bugwatch.init(api_key: "test-key")
    end

    it "captures an exception and sends an event" do
      exception = RuntimeError.new("test error")
      exception.set_backtrace(["app/models/user.rb:42:in `save'"])

      expect(mock_transport).to receive(:send_event).with(hash_including(
        level: "error",
        platform: "ruby"
      ))

      Bugwatch.capture_exception(exception)
    end

    it "does nothing when not configured" do
      Bugwatch.reset!
      expect(mock_transport).not_to receive(:send_event)
      Bugwatch.capture_exception(RuntimeError.new("test"))
    end
  end

  describe ".capture_message" do
    before do
      Bugwatch.init(api_key: "test-key")
    end

    it "captures a message and sends an event" do
      expect(mock_transport).to receive(:send_event).with(hash_including(
        message: "something happened",
        level: "warning"
      ))

      Bugwatch.capture_message("something happened", level: :warning)
    end
  end

  describe ".flush" do
    it "flushes the transport" do
      Bugwatch.init(api_key: "test-key")
      expect(mock_transport).to receive(:flush)
      Bugwatch.flush
    end
  end

  describe ".close" do
    it "closes the client" do
      Bugwatch.init(api_key: "test-key")
      expect(mock_transport).to receive(:close)
      Bugwatch.close
    end
  end
end
