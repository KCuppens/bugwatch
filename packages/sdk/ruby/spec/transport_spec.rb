# frozen_string_literal: true

require "spec_helper"

RSpec.describe Bugwatch::HttpTransport do
  let(:transport) do
    described_class.new(
      api_key: "test-key-123",
      server_url: "https://api.bugwatch.dev",
      debug: false
    )
  end

  after do
    transport.close
  end

  describe "#send_event" do
    it "posts the event to /api/v1/events with correct headers" do
      stub = stub_request(:post, "https://api.bugwatch.dev/api/v1/events")
        .with(
          headers: {
            "Content-Type" => "application/json",
            "Authorization" => "Bearer test-key-123"
          }
        )
        .to_return(status: 200, body: '{"id":"abc"}')

      event_hash = {
        event_id: "abc123",
        timestamp: "2026-01-01T00:00:00Z",
        level: "error",
        message: "test"
      }

      transport.send_event(event_hash)
      transport.flush

      # Give the background worker time to process
      sleep(0.2)

      expect(stub).to have_been_requested
    end

    it "sends the event body as JSON" do
      stub = stub_request(:post, "https://api.bugwatch.dev/api/v1/events")
        .with { |request|
          body = JSON.parse(request.body)
          body["event_id"] == "abc123" && body["level"] == "error"
        }
        .to_return(status: 200)

      transport.send_event({ event_id: "abc123", level: "error" })
      transport.flush
      sleep(0.2)

      expect(stub).to have_been_requested
    end

    it "includes User-Agent header" do
      stub = stub_request(:post, "https://api.bugwatch.dev/api/v1/events")
        .with(headers: { "User-Agent" => "bugwatch-ruby/#{Bugwatch::VERSION}" })
        .to_return(status: 200)

      transport.send_event({ event_id: "test" })
      transport.flush
      sleep(0.2)

      expect(stub).to have_been_requested
    end
  end
end

RSpec.describe Bugwatch::NoopTransport do
  it "does not raise when sending events" do
    transport = described_class.new
    expect { transport.send_event({ test: true }) }.not_to raise_error
  end
end

RSpec.describe Bugwatch::ConsoleTransport do
  it "outputs events to stderr" do
    transport = described_class.new
    expect { transport.send_event({ event_id: "test" }) }.to output(/Bugwatch/).to_stderr
  end
end
