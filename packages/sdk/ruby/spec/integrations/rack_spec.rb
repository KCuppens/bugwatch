# frozen_string_literal: true

require "spec_helper"
require "rack"
require "rack/test"

RSpec.describe Bugwatch::Rack::Middleware do
  include Rack::Test::Methods

  let(:mock_transport) { instance_double(Bugwatch::NoopTransport, send_event: nil, flush: nil, close: nil) }

  before do
    allow(Bugwatch::HttpTransport).to receive(:new).and_return(mock_transport)
    Bugwatch.init(api_key: "test-key")
  end

  context "when the app succeeds" do
    let(:app) do
      described_class.new(->(_env) { [200, { "content-type" => "text/plain" }, ["OK"]] })
    end

    it "passes the request through" do
      get "/"
      expect(last_response.status).to eq(200)
      expect(last_response.body).to eq("OK")
    end

    it "does not capture any events" do
      expect(mock_transport).not_to receive(:send_event)
      get "/"
    end
  end

  context "when the app raises an error" do
    let(:app) do
      described_class.new(lambda { |_env|
        raise RuntimeError, "something broke"
      })
    end

    it "captures the exception and re-raises" do
      expect(mock_transport).to receive(:send_event) do |event_hash|
        expect(event_hash[:exception][:type]).to eq("RuntimeError")
        expect(event_hash[:exception][:value]).to eq("something broke")
      end

      expect { get "/" }.to raise_error(RuntimeError, "something broke")
    end

    it "includes request context in the event" do
      expect(mock_transport).to receive(:send_event) do |event_hash|
        expect(event_hash[:extras]).to include(:method, :url)
        expect(event_hash[:extras][:method]).to eq("GET")
      end

      expect { get "/" }.to raise_error(RuntimeError)
    end
  end
end
