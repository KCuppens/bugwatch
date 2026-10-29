# frozen_string_literal: true

require "net/http"
require "uri"
require "json"

module Bugwatch
  class Transport
    def send_event(_event_hash)
      raise NotImplementedError, "#{self.class}#send_event must be implemented"
    end

    def flush; end

    def close; end
  end

  class HttpTransport < Transport
    TIMEOUT = 10

    def initialize(api_key:, server_url:, debug: false)
      super()
      @api_key = api_key
      @server_url = server_url
      @debug = debug
      @queue = Queue.new
      @worker = start_worker
    end

    def send_event(event_hash)
      @queue << event_hash
    end

    def flush
      # Wait for queue to drain
      sleep(0.1) until @queue.empty?
    end

    def close
      @queue << :shutdown
      @worker&.join(5)
    end

    private

    def start_worker
      Thread.new do
        loop do
          event = @queue.pop
          break if event == :shutdown

          deliver(event)
        end
      end
    end

    def deliver(event_hash)
      uri = URI.parse("#{@server_url}/api/v1/events")
      http = Net::HTTP.new(uri.host, uri.port)
      http.use_ssl = uri.scheme == "https"
      http.open_timeout = TIMEOUT
      http.read_timeout = TIMEOUT

      request = Net::HTTP::Post.new(uri.path)
      request["Content-Type"] = "application/json"
      request["Authorization"] = "Bearer #{@api_key}"
      request["User-Agent"] = "bugwatch-ruby/#{Bugwatch::VERSION}"
      request.body = JSON.generate(event_hash)

      response = http.request(request)

      warn "[Bugwatch] Event sent: #{response.code} #{response.message}" if @debug
    rescue StandardError => e
      warn "[Bugwatch] Failed to send event: #{e.message}" if @debug
    end
  end

  class NoopTransport < Transport
    def send_event(_event_hash); end
  end

  class ConsoleTransport < Transport
    def send_event(event_hash)
      warn "[Bugwatch] Event: #{JSON.pretty_generate(event_hash)}"
    end
  end
end
