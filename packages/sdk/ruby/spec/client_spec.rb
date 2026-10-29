# frozen_string_literal: true

require "spec_helper"

RSpec.describe Bugwatch::Client do
  let(:config) do
    cfg = Bugwatch::Configuration.new
    cfg.api_key = "test-key-123"
    cfg.environment = "test"
    cfg.release = "1.0.0"
    cfg
  end

  let(:mock_transport) { instance_double(Bugwatch::NoopTransport, send_event: nil, flush: nil, close: nil) }

  let(:client) do
    c = described_class.new(config)
    c.transport = mock_transport
    c
  end

  describe "#capture_exception" do
    it "builds and sends an error event" do
      exception = RuntimeError.new("something broke")
      exception.set_backtrace([
        "app/models/user.rb:42:in `save'",
        "app/controllers/users_controller.rb:10:in `create'"
      ])

      expect(mock_transport).to receive(:send_event) do |event_hash|
        expect(event_hash[:level]).to eq("error")
        expect(event_hash[:exception][:type]).to eq("RuntimeError")
        expect(event_hash[:exception][:value]).to eq("something broke")
        expect(event_hash[:exception][:stacktrace].length).to eq(2)
        expect(event_hash[:environment]).to eq("test")
        expect(event_hash[:release]).to eq("1.0.0")
        expect(event_hash[:fingerprint]).to be_a(String)
      end

      client.capture_exception(exception)
    end

    it "includes context as extras" do
      exception = RuntimeError.new("test")
      exception.set_backtrace([])

      expect(mock_transport).to receive(:send_event) do |event_hash|
        expect(event_hash[:extras]).to eq({ user_id: 42 })
      end

      client.capture_exception(exception, context: { user_id: 42 })
    end

    it "calls before_send if configured" do
      config.before_send = proc { |event|
        event.tags[:custom] = "value"
        event
      }

      exception = RuntimeError.new("test")
      exception.set_backtrace([])

      expect(mock_transport).to receive(:send_event) do |event_hash|
        expect(event_hash[:tags][:custom]).to eq("value")
      end

      client.capture_exception(exception)
    end

    it "drops event if before_send returns nil" do
      config.before_send = proc {}

      exception = RuntimeError.new("test")
      exception.set_backtrace([])

      expect(mock_transport).not_to receive(:send_event)
      result = client.capture_exception(exception)
      expect(result).to be_nil
    end
  end

  describe "#capture_message" do
    it "builds and sends a message event" do
      expect(mock_transport).to receive(:send_event) do |event_hash|
        expect(event_hash[:message]).to eq("deployment completed")
        expect(event_hash[:level]).to eq("info")
      end

      client.capture_message("deployment completed", level: :info)
    end
  end

  describe "#flush" do
    it "delegates to transport" do
      expect(mock_transport).to receive(:flush)
      client.flush
    end
  end

  describe "#close" do
    it "delegates to transport" do
      expect(mock_transport).to receive(:close)
      client.close
    end
  end
end
